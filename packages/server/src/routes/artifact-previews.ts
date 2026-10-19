import {
  MANAGED_ARTIFACT_MAX_FILE_BYTES as MAX_FILE_BYTES,
  MANAGED_ARTIFACT_MAX_VIEWER_BYTES as MAX_VIEWER_BYTES,
  MANAGED_ARTIFACT_READ_IDLE_MS,
} from "@yep-anywhere/shared";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { type Context, Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import { type Principal, PRINCIPAL_VARIABLE } from "../auth/principal.js";
import { fileBytesResponse } from "../artifacts/fileResponse.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import {
  createLocalResourcePathPolicy,
  isPathInsideDirectory,
} from "./local-resource-policy.js";
import { openMutableFileSnapshot } from "./mutable-file-cache.js";
import type { SessionPathScopeResolver } from "./session-path-scope.js";
import { createUntrustedFileResponseHeaders } from "./untrusted-file-response.js";

const LIFETIME_MS = 30 * 60_000;
const MAX_LEASES = 128;

interface PreviewLease {
  id: string;
  owner: string;
  sessionId: string | undefined;
  requestedPath: string;
  root: string;
  entry: string;
  expiresAt: number;
  bytes: number;
  files: Set<string>;
  readers: Set<() => void>;
}

/** Authenticated read-only viewer leases; never public links or file ownership. */
export function createArtifactPreviewRoutes(deps: {
  policy: ReturnType<typeof createLocalResourcePathPolicy>;
  scope: SessionPathScopeResolver;
  scanner: Pick<ProjectScanner, "getProject" | "listProjects">;
  now?: () => number;
  /** Tests may lower, never widen, the production delivered-byte budget. */
  maxViewerBytes?: number;
}) {
  const routes = new Hono();
  // At most 128 leases, pruned on admission/access and disposed with the app.
  const leases = new Map<string, PreviewLease>();
  const now = deps.now ?? Date.now;
  const maxViewerBytes = Math.max(
    1,
    Math.min(deps.maxViewerBytes ?? MAX_VIEWER_BYTES, MAX_VIEWER_BYTES),
  );
  let readers = 0;
  let closed = false;
  const owner = (c: Context) => {
    const principal = c.get(PRINCIPAL_VARIABLE) as Principal | undefined;
    return principal?.kind === "limited"
      ? `user:${principal.username}`
      : "owner";
  };
  const release = (lease: PreviewLease) => {
    leases.delete(lease.id);
    for (const stop of [...lease.readers]) stop();
  };
  function find(c: Context) {
    const lease = leases.get(c.req.param("id") ?? "");
    if (!lease) return;
    if (lease.expiresAt <= now()) {
      release(lease);
      return;
    }
    if (
      lease.owner !== owner(c) ||
      lease.sessionId !== c.req.param("sessionId")
    )
      return;
    return lease;
  }
  function policy(c: Context, requestedPath: string) {
    if (!c.req.param("sessionId"))
      return { policy: deps.policy, hostPath: requestedPath };
    const scoped = deps.scope(c, requestedPath);
    if ("status" in scoped) return;
    return {
      policy: createLocalResourcePathPolicy({
        ...scoped,
        scanner: deps.scanner,
      }),
      hostPath: scoped.hostPath,
    };
  }

  const admit = async (c: Context) => {
    if (closed) return c.json({ error: "Viewer service closed" }, 503);
    for (const lease of leases.values())
      if (lease.expiresAt <= now()) release(lease);
    if (
      leases.size >= MAX_LEASES ||
      [...leases.values()].filter((v) => v.owner === owner(c)).length >= 16
    )
      return c.json({ error: "Too many open previews" }, 429);
    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== "object")
      return c.json({ error: "Expected entry path" }, 400);
    const { path, projectId } = body as Record<string, unknown>;
    if (
      typeof path !== "string" ||
      path.length > 4096 ||
      (projectId !== undefined && typeof projectId !== "string")
    )
      return c.json(
        { error: "Expected entry path and optional projectId" },
        400,
      );
    let requestedPath = expandHomePath(path);
    if (!c.req.param("sessionId") && projectId) {
      const project = await deps.scanner.getProject(projectId);
      if (!project) return c.json({ error: "Project not found" }, 404);
      requestedPath = resolve(project.path, requestedPath);
    }
    if (!isAbsolute(requestedPath))
      return c.json({ error: "Path must be absolute" }, 400);
    const scoped = policy(c, requestedPath);
    if (!scoped) return c.json({ error: "Session not found" }, 404);
    const allowed = await scoped.policy.resolveAllowedFilePath(scoped.hostPath);
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
    if (
      ![".html", ".htm"].includes(
        extname(allowed.file.resolvedPath).toLowerCase(),
      )
    )
      return c.json({ error: "Preview entry must be HTML" }, 400);
    const lease: PreviewLease = {
      id: randomUUID(),
      owner: owner(c),
      sessionId: c.req.param("sessionId"),
      requestedPath,
      root: dirname(allowed.file.resolvedPath),
      entry: basename(allowed.file.resolvedPath),
      expiresAt: now() + LIFETIME_MS,
      bytes: 0,
      files: new Set(),
      readers: new Set(),
    };
    // Authorization above awaits filesystem work; enforce admission again.
    if (
      closed ||
      leases.size >= MAX_LEASES ||
      [...leases.values()].filter((v) => v.owner === lease.owner).length >= 16
    )
      return c.json({ error: "Too many open previews" }, 429);
    leases.set(lease.id, lease);
    return c.json({
      id: lease.id,
      entry: lease.entry,
      expiresAt: lease.expiresAt,
    });
  };
  const revoke = (c: Context) => {
    const lease = find(c);
    if (!lease)
      return c.json(
        {
          error: "Preview expired or unavailable",
          reason: "preview-unavailable",
        },
        404,
      );
    release(lease);
    return c.json({ success: true });
  };
  const read = async (c: Context) => {
    const lease = find(c);
    if (!lease)
      return c.json(
        {
          error: "Preview expired or unavailable",
          reason: "preview-unavailable",
        },
        404,
      );
    const path = c.req.query("path");
    if (
      !path ||
      path.length > 4096 ||
      path.includes("\\") ||
      path.includes("\0") ||
      path.startsWith("/") ||
      path.split("/").some((p) => !p || p.startsWith("."))
    )
      return c.json({ error: "Invalid preview path" }, 400);
    // Headroom above the client's 8/32 avoids transient refusal while a
    // canceled relay request is still retiring on the server.
    if (readers >= 64 || lease.readers.size >= 16)
      return c.json({ error: "Too many preview reads" }, 429);
    let freed = false;
    let cancelled = false;
    let handedOff = false;
    let cancelActive: (() => void) | undefined;
    const stopPending = () => {
      cancelled = true;
      cancelActive?.();
    };
    const freeSlot = () => {
      if (freed) return;
      freed = true;
      clearTimeout(deadline);
      c.req.raw.signal.removeEventListener("abort", stopPending);
      lease.readers.delete(stopPending);
      readers--;
    };
    readers++;
    lease.readers.add(stopPending);
    let deadline: ReturnType<typeof setTimeout>;
    const progress = () => {
      clearTimeout(deadline);
      deadline = setTimeout(
        stopPending,
        Math.min(
          MANAGED_ARTIFACT_READ_IDLE_MS,
          Math.max(1, lease.expiresAt - now()),
        ),
      );
      deadline.unref?.();
    };
    progress();
    c.req.raw.signal.addEventListener("abort", stopPending, { once: true });
    if (c.req.raw.signal.aborted) stopPending();
    try {
      const scoped = policy(c, lease.requestedPath);
      if (!scoped) return c.json({ error: "Session unavailable" }, 403);
      const candidate = resolve(lease.root, path);
      if (!isPathInsideDirectory(candidate, lease.root))
        return c.json({ error: "Outside preview" }, 403);
      const canonical = await realpath(candidate).catch(() => null);
      if (!canonical || !isPathInsideDirectory(canonical, lease.root))
        return c.json({ error: "File unavailable" }, 404);
      const allowed = await scoped.policy.resolveAllowedFilePath(canonical);
      if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
      // A changed session mapping or entry symlink must not extend an old lease.
      const entry = await realpath(scoped.hostPath).catch(() => null);
      if (entry !== resolve(lease.root, lease.entry))
        return c.json({ error: "Preview entry changed" }, 403);
      if (!lease.files.has(canonical) && lease.files.size >= 1024)
        return c.json({ error: "Preview file limit" }, 413);
      const snapshot = await openMutableFileSnapshot(canonical).catch(
        () => null,
      );
      if (!snapshot) return c.json({ error: "File unavailable" }, 404);
      const { handle, stats } = snapshot;
      if (
        stats.dev !== allowed.file.stats.dev ||
        stats.ino !== allowed.file.stats.ino ||
        (await realpath(candidate).catch(() => null)) !== canonical
      ) {
        await handle.close();
        return c.json({ error: "File changed while opening" }, 409);
      }
      if (
        cancelled ||
        leases.get(lease.id) !== lease ||
        lease.expiresAt <= now()
      ) {
        await handle.close();
        return c.json(
          {
            error: "Preview expired or unavailable",
            reason: "preview-unavailable",
          },
          404,
        );
      }
      if (stats.size > MAX_FILE_BYTES) {
        await handle.close();
        return c.json({ error: "Preview file too large" }, 413);
      }
      const mime = getMimeType(canonical) ?? "application/octet-stream";
      const response = await fileBytesResponse(c.req.raw, handle, stats, mime);
      if (
        cancelled ||
        leases.get(lease.id) !== lease ||
        lease.expiresAt <= now()
      ) {
        await response.body?.cancel();
        return c.json(
          {
            error: "Preview expired or unavailable",
            reason: "preview-unavailable",
          },
          404,
        );
      }
      const responseBytes = response.body
        ? Number(response.headers.get("content-length"))
        : 0;
      if (
        (!lease.files.has(canonical) && lease.files.size >= 1024) ||
        !Number.isSafeInteger(responseBytes) ||
        responseBytes < 0 ||
        lease.bytes >= maxViewerBytes
      ) {
        await response.body?.cancel();
        return c.json({ error: "Preview byte limit" }, 413);
      }
      lease.files.add(canonical);
      // Charge produced bytes, so cancelling an open-ended seek does not
      // spend the entire promised range. Reader slots still bound concurrency.
      const headers = createUntrustedFileResponseHeaders({
        baseHeaders: response.headers,
        filePath: canonical,
        contentType: mime,
      });
      headers.set("Cache-Control", "no-store");
      headers.set("Referrer-Policy", "no-referrer");
      if (!response.body)
        return new Response(null, { status: response.status, headers });
      const reader = response.body.getReader();
      let finished = false;
      let output: ReadableStreamDefaultController<Uint8Array>;
      const finish = () => {
        if (finished) return;
        finished = true;
        freeSlot();
      };
      const stop = () => {
        if (finished) return;
        finish();
        void reader.cancel().catch(() => {});
        output.error(new Error("Preview read ended"));
      };
      cancelActive = stop;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          output = controller;
        },
        async pull(controller) {
          try {
            const part = await reader.read();
            if (finished) return;
            if (part.done) {
              finish();
              controller.close();
            } else {
              if (lease.bytes + part.value.byteLength > maxViewerBytes) {
                stop();
                return;
              }
              lease.bytes += part.value.byteLength;
              progress();
              controller.enqueue(part.value);
            }
          } catch (error) {
            if (!finished) {
              finish();
              controller.error(error);
            }
          }
        },
        async cancel() {
          finish();
          await reader.cancel().catch(() => {});
        },
      });
      handedOff = true;
      return new Response(stream, { status: response.status, headers });
    } finally {
      if (!handedOff) freeSlot();
    }
  };
  routes.post("/artifact-previews", admit);
  routes.post("/sessions/:sessionId/artifact-previews", admit);
  routes.delete("/artifact-previews/:id", revoke);
  routes.delete("/sessions/:sessionId/artifact-previews/:id", revoke);
  routes.get("/artifact-previews/:id/file", read);
  routes.get("/sessions/:sessionId/artifact-previews/:id/file", read);
  return {
    routes,
    close() {
      closed = true;
      for (const lease of [...leases.values()]) release(lease);
    },
  };
}
