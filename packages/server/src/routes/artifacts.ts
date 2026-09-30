import { resolve } from "node:path";
import { Hono } from "hono";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import {
  createArtifactConfigWriter,
  type ArtifactConfigWriter,
} from "./artifactConfigWriter.js";

export function createArtifactRoutes(options: {
  server: ArtifactServer;
  scanner: Pick<ProjectScanner, "getProject">;
  settings?: ServerSettingsService;
  locked: boolean;
  /** Shared with other configuration writers; one is made when absent. */
  writer?: ArtifactConfigWriter;
  onArtifactCreated?: (path: string, projectId?: string) => Promise<void>;
}) {
  const routes = new Hono();
  const writer = options.writer ?? createArtifactConfigWriter(options);
  routes.put("/artifacts/config", async (c) => {
    const body = await c.req.json<unknown>();
    return (await writer.apply(c, body)) ?? c.json({ success: true });
  });
  routes.post("/artifacts", async (c) => {
    if (!options.server.available)
      return c.json({ error: "Artifact serving is disabled" }, 409);
    const body = await c.req.json<unknown>();
    if (!body || typeof body !== "object")
      return c.json({ error: "Invalid artifact request" }, 400);
    const { path, projectId, audience, owned } = body as Record<
      string,
      unknown
    >;
    if (
      typeof path !== "string" ||
      (audience !== "local" && audience !== "public") ||
      (projectId !== undefined && typeof projectId !== "string") ||
      (owned !== undefined && typeof owned !== "boolean")
    )
      return c.json(
        {
          error: "Expected path, optional projectId, and local/public audience",
        },
        400,
      );
    let filePath = expandHomePath(path);
    let canonicalProjectId: string | undefined;
    if (projectId) {
      const project = await options.scanner.getProject(projectId);
      if (!project) return c.json({ error: "Project not found" }, 404);
      filePath = resolve(project.path, filePath);
      canonicalProjectId = project.id;
    }
    const grant = await options.server.createGrant(
      filePath,
      audience,
      owned as boolean | undefined,
    );
    if (options.onArtifactCreated)
      await options.onArtifactCreated(
        await options.server.resolveSourceUrl(grant.url),
        canonicalProjectId,
      );
    return c.json(grant);
  });
  routes.delete("/artifacts/:id", async (c) => {
    await options.server.revoke(c.req.param("id"));
    return c.json({ success: true });
  });
  return routes;
}
