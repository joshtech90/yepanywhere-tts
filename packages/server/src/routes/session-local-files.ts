import { isAbsolute } from "node:path";
import { Hono } from "hono";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import { createLocalFileHandler } from "./local-file.js";
import { createLocalImageHandler } from "./local-image.js";
import { createLocalResourcePathPolicy } from "./local-resource-policy.js";
import type { SessionPathScopeResolver } from "./session-path-scope.js";

/**
 * Files as one session names them: reads, and interactive previews of them.
 * The session in the path is what the limited-user policy judges (view for
 * reads, join for a preview); `scope` maps a sandboxed session's /tmp to its
 * private directory and confines a limited user
 * (topics/session-sandboxing.md, capability `session-scoped-local-files`).
 */
export function createSessionLocalFileRoutes(deps: {
  allowedPaths: () => string[];
  includeProjects: () => boolean;
  scanner: Pick<ProjectScanner, "listProjects">;
  scope: SessionPathScopeResolver;
  artifactServer: ArtifactServer;
  onArtifactCreated?: (sessionId: string, path: string) => Promise<void>;
}) {
  const routes = new Hono();
  const fileDeps = {
    allowedPaths: deps.allowedPaths,
    includeProjects: deps.includeProjects,
    scanner: deps.scanner,
    scope: deps.scope,
  };
  routes.get(
    "/sessions/:sessionId/local-file",
    createLocalFileHandler(fileDeps),
  );
  routes.get(
    "/sessions/:sessionId/local-image",
    createLocalImageHandler(fileDeps),
  );

  // An interactive preview borrows its directory; ownership is reserved for
  // callers that produced it.
  routes.post("/sessions/:sessionId/artifacts", async (c) => {
    if (!deps.artifactServer.available)
      return c.json({ error: "Artifact serving is disabled" }, 409);
    const body = await c.req.json<unknown>().catch(() => undefined);
    const { path, audience } = (body ?? {}) as Record<string, unknown>;
    if (
      typeof path !== "string" ||
      (audience !== "local" && audience !== "public")
    )
      return c.json({ error: "Expected path and local/public audience" }, 400);
    if (!isAbsolute(expandHomePath(path)))
      return c.json({ error: "Path must be absolute" }, 400);
    const scoped = deps.scope(c, path);
    if ("status" in scoped)
      return c.json({ error: scoped.error }, scoped.status);
    const allowed = await createLocalResourcePathPolicy({
      ...scoped,
      scanner: deps.scanner,
    }).resolveAllowedFilePath(scoped.hostPath);
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
    const grant = await deps.artifactServer.createGrant(
      allowed.file.resolvedPath,
      audience,
      false,
    );
    await deps.onArtifactCreated?.(
      c.req.param("sessionId"),
      allowed.file.resolvedPath,
    );
    return c.json(grant);
  });
  return routes;
}
