import { randomBytes, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { basename, dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getMimeType } from "hono/utils/mime";
import {
  isPathInsideDirectory,
  type createLocalResourcePathPolicy,
} from "../routes/local-resource-policy.js";
import { openMutableFileSnapshot } from "../routes/mutable-file-cache.js";
import { validateArtifactConfig, type ArtifactConfig } from "./config.js";
import {
  deletableDirectory,
  GrantStore,
  type PendingDeletion,
  type StoredGrant,
} from "./GrantStore.js";
import { registerArtifactOrigins } from "../middleware/allowed-hosts.js";

const MAX_GRANTS = 256;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const ARTIFACT_CSP = [
  "sandbox allow-scripts allow-same-origin",
  "default-src 'self' data: blob: http: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
  "style-src 'self' 'unsafe-inline' data: blob: http: https:",
  "connect-src 'self' http: https: ws: wss:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

interface Grant extends StoredGrant {
  files: Set<string>;
}

/** How often expiry is noticed without traffic; deletions owe a deadline. */
const SWEEP_MS = 60_000;

export interface ArtifactServerOptions {
  /** Where grants and pending deletions survive a restart. */
  stateDir?: string;
  /** Directories an owning grant may never delete, whatever a caller says. */
  protectedPaths?: readonly (string | undefined)[];
}

export class ArtifactServer {
  readonly app = new Hono();
  private readonly grants = new Map<string, Grant>();
  private listener: Server | undefined;
  private listening = false;

  private readonly store: GrantStore;
  private readonly protectedPaths: readonly (string | undefined)[];
  private deletions: PendingDeletion[] = [];
  private sweepTimer?: ReturnType<typeof setInterval>;
  /** Restore runs once; every path that reads grants waits for it. */
  readonly ready: Promise<void>;

  constructor(
    public config: ArtifactConfig,
    private readonly policy: ReturnType<typeof createLocalResourcePathPolicy>,
    options: ArtifactServerOptions = {},
  ) {
    this.config = validateArtifactConfig(config);
    this.store = new GrantStore(options.stateDir);
    this.protectedPaths = options.protectedPaths ?? [];
    this.ready = this.restore();
    registerArtifactOrigins([config.localOrigin, config.publicOrigin]);
    this.app.use("*", async (c, next) => {
      await this.ready;
      if (!this.matchesHost(c.req.header("Host") ?? new URL(c.req.url).host))
        return c.text("Unknown artifact host", 421);
      c.header("Content-Security-Policy", ARTIFACT_CSP);
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "no-referrer");
      c.header("Cache-Control", "no-store");
      c.header(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), payment=(), usb=(), serial=(), bluetooth=(), display-capture=()",
      );
      if (c.req.method !== "GET" && c.req.method !== "HEAD")
        return c.text("Read only", 405);
      await next();
    });
    this.app.get("/health", (c) => {
      c.header("Access-Control-Allow-Origin", "*");
      return c.json({ artifactViewer: 1 });
    });
    this.app.get("/a/:token/*", async (c) => {
      const grant = this.grants.get(c.req.param("token"));
      if (!grant || grant.expiresAt <= Date.now()) {
        if (grant) this.grants.delete(grant.token);
        return c.notFound();
      }
      const prefix = `/a/${grant.token}/`;
      const encoded = new URL(c.req.url).pathname.slice(prefix.length);
      let relative: string;
      try {
        relative = decodeURIComponent(encoded);
      } catch {
        return c.text("Invalid artifact path", 400);
      }
      if (
        !relative ||
        relative.includes("\\") ||
        relative.includes("\0") ||
        relative
          .split("/")
          .some((part) => part === ".." || part.startsWith("."))
      ) {
        return c.text("Invalid artifact path", 400);
      }
      const candidate = resolve(grant.root, relative);
      if (!isPathInsideDirectory(candidate, grant.root)) return c.notFound();
      let canonical: string;
      try {
        canonical = await realpath(candidate);
      } catch (error) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          return c.notFound();
        throw error;
      }
      if (!isPathInsideDirectory(canonical, grant.root)) return c.notFound();
      const allowed = await this.policy.resolveAllowedFilePath(canonical);
      if (!allowed.ok) return c.text(allowed.error, allowed.status);
      if (!grant.files.has(canonical) && grant.files.size >= 1024)
        return c.text("Artifact file limit reached", 413);
      const snapshot = await openMutableFileSnapshot(canonical);
      if (!snapshot) return c.notFound();
      const { handle, stats } = snapshot;
      if (stats.size > MAX_FILE_BYTES) {
        await handle.close();
        return c.text("Artifact file exceeds 64 MiB", 413);
      }
      grant.files.add(canonical);
      const mime = getMimeType(canonical) ?? "application/octet-stream";
      c.header("Content-Type", mime);
      c.header("Accept-Ranges", "bytes");
      let start = 0;
      let end = stats.size - 1;
      const range = c.req.header("Range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (match && (match[1] || match[2])) {
          start = match[1]
            ? Number(match[1])
            : Math.max(0, stats.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        }
        if (
          !match ||
          (!match[1] && !match[2]) ||
          start > end ||
          start >= stats.size ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end)
        ) {
          await handle.close();
          c.header("Content-Range", `bytes */${stats.size}`);
          return c.body(null, 416);
        }
        c.header("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      }
      c.header("Content-Length", String(Math.max(0, end - start + 1)));
      if (c.req.method === "HEAD" || stats.size === 0) {
        await handle.close();
        return c.body(null, range ? 206 : 200);
      }
      const stream = handle.createReadStream({ start, end, autoClose: true });
      return c.body(
        Readable.toWeb(stream) as ReadableStream,
        range ? 206 : 200,
      );
    });
  }

  /**
   * Adopt saved grants, drop the ones that expired while the server was down,
   * and settle anything they owed. A grant that expired unnoticed still owes
   * its deletion, so the queue is read before the first request is served.
   */
  private async restore(): Promise<void> {
    const state = await this.store.load();
    const now = Date.now();
    this.deletions = state.deletions;
    for (const stored of state.grants) {
      if (stored.expiresAt > now) {
        this.grants.set(stored.token, { ...stored, files: new Set() });
        continue;
      }
      if (stored.owned)
        this.owe(stored.root, stored.ownedFiles ?? [], stored.expiresAt);
    }
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref?.();
    await this.sweep();
  }

  private owe(root: string, files: readonly string[], dueAt: number): void {
    const existing = this.deletions.find((pending) => pending.root === root);
    // Two grants over one directory own the union of what each froze.
    if (existing) existing.files = [...new Set([...existing.files, ...files])];
    else this.deletions.push({ root, files: [...files], dueAt });
  }

  private persist(): Promise<void> {
    return this.store.save(
      [...this.grants.values()].map(({ files: _files, ...stored }) => stored),
      this.deletions,
    );
  }

  /** Expire grants, pay the deletions they owe, and save what remains. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt > now) continue;
      this.grants.delete(token);
      if (grant.owned)
        this.owe(grant.root, grant.ownedFiles ?? [], grant.expiresAt);
    }
    const due = this.deletions.filter((pending) => pending.dueAt <= now);
    if (due.length) {
      // A directory that failed to delete is dropped rather than retried
      // forever; the grant is gone either way and nothing is served from it.
      for (const pending of due)
        await GrantStore.deleteFrozen(pending.root, pending.files);
      this.deletions = this.deletions.filter((pending) => pending.dueAt > now);
    }
    await this.persist();
  }

  /** Awaitable sweep for callers that must observe the result. */
  async settleExpired(): Promise<void> {
    await this.ready;
    await this.sweep();
    await this.store.settled();
  }

  get available(): boolean {
    return Boolean(this.config.localOrigin) || this.listening;
  }

  matchesHost(host: string): boolean {
    return [this.config.localOrigin, this.config.publicOrigin].some(
      (origin) => origin && new URL(origin).host === host.toLowerCase(),
    );
  }

  async configure(config: ArtifactConfig): Promise<void> {
    config = validateArtifactConfig(
      config,
      this.config.expiryDays,
      this.config.deleteOnExpiry,
    );
    const previous = this.config;
    const deliveryChanged =
      config.port !== previous.port ||
      config.localOrigin !== previous.localOrigin ||
      config.publicOrigin !== previous.publicOrigin;
    const wasListening = this.listening;
    if (
      config.port !== previous.port ||
      (this.listening && !config.publicOrigin)
    )
      await this.close();
    this.config = config;
    registerArtifactOrigins([config.localOrigin, config.publicOrigin]);
    try {
      if (!this.listening && config.publicOrigin) await this.start();
      if (deliveryChanged) {
        // Changing where artifacts are served revokes outstanding links, and
        // an owning grant pays its deletion on revocation.
        for (const [token, grant] of this.grants) {
          this.grants.delete(token);
          if (grant.owned)
            this.owe(grant.root, grant.ownedFiles ?? [], Date.now());
        }
        void this.sweep();
      }
    } catch (error) {
      this.listener = undefined;
      this.config = previous;
      if (wasListening && !this.listening) await this.start();
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.listener) throw new Error("Artifact server already started");
    await new Promise<void>((resolveReady, reject) => {
      const listener = createServer(getRequestListener(this.app.fetch));
      this.listener = listener;
      listener.once("error", reject);
      listener.listen(this.config.port, "127.0.0.1", () => {
        listener.removeListener("error", reject);
        this.listening = true;
        resolveReady();
      });
    });
  }

  async close(): Promise<void> {
    this.listening = false;
    // Persisted grants outlive the process; only this listener stops here.
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    // A half-written state file would lose grants a caller already holds.
    await this.store.settled();
    this.grants.clear();
    const listener = this.listener;
    this.listener = undefined;
    if (listener) {
      listener.closeAllConnections();
      await new Promise<void>((resolveClosed, reject) =>
        listener.close((error) => (error ? reject(error) : resolveClosed())),
      );
    }
  }

  async createGrant(
    filePath: string,
    audience: "local" | "public",
    owned?: boolean,
  ) {
    await this.ready;
    const origin =
      audience === "local" ? this.config.localOrigin : this.config.publicOrigin;
    if (!origin)
      throw new HTTPException(409, {
        message: `No ${audience} artifact origin configured`,
      });
    const allowed = await this.policy.resolveAllowedFilePath(filePath);
    if (!allowed.ok)
      throw new HTTPException(allowed.status, { message: allowed.error });
    if (
      ![".html", ".htm"].includes(
        extname(allowed.file.resolvedPath).toLowerCase(),
      )
    ) {
      throw new HTTPException(400, {
        message: "Artifact entry must be an HTML file",
      });
    }
    const now = Date.now();
    for (const [token, grant] of this.grants)
      if (grant.expiresAt <= now) this.grants.delete(token);
    if (this.grants.size >= MAX_GRANTS)
      throw new HTTPException(429, {
        message: "Close an artifact viewer before opening another",
      });
    const token = randomBytes(32).toString("base64url");
    const root = dirname(allowed.file.resolvedPath);
    // Ownership is refused rather than honoured for a directory that is
    // plainly not a disposable bundle; the grant is still created, borrowing.
    // Ownership is never inherited from configuration: a preview of a file
    // the user already had must not delete it when the viewer closes. Only a
    // caller that produced the directory says so, by asking.
    const wants = owned === true;
    // Ownership freezes the fileset: exactly what is here now is what this
    // grant may remove later, whatever else the directory collects.
    const frozen =
      wants && (await deletableDirectory(root, this.protectedPaths))
        ? await GrantStore.freeze(root)
        : null;
    const grant: Grant = {
      id: randomUUID(),
      token,
      root,
      entry: basename(allowed.file.resolvedPath),
      expiresAt: now + this.config.expiryDays! * 24 * 60 * 60 * 1000,
      owned: frozen !== null,
      ...(frozen ? { ownedFiles: frozen } : {}),
      files: new Set(),
    };
    this.grants.set(token, grant);
    // The caller is handed a URL, so the grant must already be durable.
    await this.persist();
    return {
      id: grant.id,
      url: `${origin}/a/${token}/${encodeURIComponent(grant.entry)}`,
      expiresAt: grant.expiresAt,
      owned: grant.owned,
    };
  }

  /** Revoking an owning grant pays its deletion now, not at its old deadline. */
  revoke(id: string): void {
    for (const [token, grant] of this.grants)
      if (grant.id === id) {
        this.grants.delete(token);
        if (grant.owned)
          this.owe(grant.root, grant.ownedFiles ?? [], Date.now());
      }
    void this.sweep();
  }
}
