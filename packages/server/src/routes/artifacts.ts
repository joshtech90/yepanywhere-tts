import { resolve } from "node:path";
import { Hono } from "hono";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import {
  validateArtifactConfig,
  type ArtifactConfig,
} from "../artifacts/config.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import { expandHomePath } from "../utils/expandHomePath.js";

export function createArtifactRoutes(options: {
  server: ArtifactServer;
  scanner: Pick<ProjectScanner, "getProject">;
  settings?: ServerSettingsService;
  locked: boolean;
}) {
  const routes = new Hono();
  let updating = false;
  routes.put("/artifacts/config", async (c) => {
    if (options.locked || !options.settings)
      return c.json(
        { error: "Artifact configuration is controlled at launch" },
        409,
      );
    if (updating)
      return c.json({ error: "Artifact configuration is being updated" }, 409);
    let config: ArtifactConfig;
    try {
      config = validateArtifactConfig(
        await c.req.json(),
        options.server.config.expiryDays,
        options.server.config.deleteOnExpiry,
      );
      const requestHost = new URL(
        `http://${c.req.header("Host") ?? new URL(c.req.url).host}`,
      ).hostname;
      const clientBase = options.settings.getSetting("yaClientBaseUrl");
      const yaHosts = [
        requestHost,
        clientBase ? new URL(clientBase).hostname : undefined,
      ];
      if (
        [config.localOrigin, config.publicOrigin].some(
          (origin) => origin && yaHosts.includes(new URL(origin).hostname),
        )
      ) {
        throw new Error("Artifacts require a different hostname from YA");
      }
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid artifact configuration",
        },
        400,
      );
    }
    updating = true;
    const previous = options.server.config;
    try {
      await options.server.configure(config);
      try {
        await options.settings.updateSettings({ artifactViewer: config });
      } catch (error) {
        await options.server.configure(previous);
        throw error;
      }
      return c.json({ success: true });
    } finally {
      updating = false;
    }
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
    if (projectId) {
      const project = await options.scanner.getProject(projectId);
      if (!project) return c.json({ error: "Project not found" }, 404);
      filePath = resolve(project.path, filePath);
    }
    return c.json(
      await options.server.createGrant(
        filePath,
        audience,
        owned as boolean | undefined,
      ),
    );
  });
  routes.delete("/artifacts/:id", (c) => {
    options.server.revoke(c.req.param("id"));
    return c.json({ success: true });
  });
  return routes;
}
