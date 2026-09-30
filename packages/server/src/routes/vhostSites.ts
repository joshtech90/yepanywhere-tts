import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArtifactVhostSiteView } from "@yep-anywhere/shared";
import { Hono } from "hono";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import type { ArtifactVhostSite } from "../artifacts/config.js";
import { APP_ACCESS_QUERY } from "../artifacts/VhostAccess.js";
import { clientVhostSite, configuredVhostNames } from "../artifacts/vhosts.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import type { ArtifactConfigWriter } from "./artifactConfigWriter.js";

/**
 * Owner routes for file vhosts: list a file's rows, claim a name, release it.
 * Every change goes through the shared configuration writer, so it is saved
 * exactly as a Settings edit would be.
 */
export function createVhostSiteRoutes(options: {
  server: ArtifactServer;
  scanner: Pick<ProjectScanner, "getProject">;
  writer: ArtifactConfigWriter;
}) {
  const routes = new Hono();

  /** An owner's view of a file row: its addresses, and what it serves now. */
  async function siteView(
    site: ArtifactVhostSite,
  ): Promise<ArtifactVhostSiteView> {
    const config = options.server.config;
    const token = site.public
      ? undefined
      : options.server.vhostAccess.token(site);
    const address = (url: URL) => {
      if (token) url.searchParams.set(APP_ACCESS_QUERY, token);
      return url.href;
    };
    let kind: ArtifactVhostSiteView["kind"] = "missing";
    try {
      kind = (await stat(site.path)).isDirectory() ? "directory" : "file";
    } catch {}
    let localUrl: string | undefined;
    if (config.localOrigin) {
      const url = new URL(config.localOrigin);
      url.hostname = `${site.name}.localhost`;
      localUrl = address(url);
    }
    return {
      ...clientVhostSite(site),
      kind,
      ...(config.vhostPublicRoot
        ? {
            publicUrl: address(
              new URL(`https://${site.name}.${config.vhostPublicRoot}/`),
            ),
          }
        : {}),
      ...(localUrl ? { localUrl } : {}),
    };
  }

  /** An absolute path, resolving a relative one against its project. */
  async function absolutePath(
    path: string,
    projectId: unknown,
  ): Promise<string | null> {
    const expanded = expandHomePath(path.trim());
    if (typeof projectId !== "string" || !projectId) return expanded;
    const project = await options.scanner.getProject(projectId);
    return project ? resolve(project.path, expanded) : null;
  }

  routes.get("/artifacts/vhost-sites", async (c) => {
    await options.server.ready;
    const path = c.req.query("path");
    const wanted = path
      ? await absolutePath(path, c.req.query("projectId"))
      : undefined;
    if (wanted === null) return c.json({ error: "Project not found" }, 404);
    const sites = (options.server.config.vhostSites ?? []).filter(
      (site) => wanted === undefined || site.path === wanted,
    );
    return c.json({ sites: await Promise.all(sites.map(siteView)) });
  });

  // First claim wins: the name is checked against every vhost row and
  // project app address inside the same serialized configuration change.
  routes.post("/artifacts/vhost-sites", async (c) => {
    const body = (await c.req.json<unknown>().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      typeof body.name !== "string" ||
      typeof body.path !== "string" ||
      (body.public !== undefined && typeof body.public !== "boolean") ||
      (body.password !== undefined && typeof body.password !== "string")
    )
      return c.json({ error: "Expected name, path and optional public" }, 400);
    const name = body.name.trim().toLowerCase();
    const path = await absolutePath(body.path, body.projectId);
    if (path === null) return c.json({ error: "Project not found" }, 404);
    const config = options.server.config;
    if (configuredVhostNames(config).includes(name))
      return c.json({ error: `The name "${name}" is already taken` }, 409);
    try {
      await stat(path);
    } catch {
      return c.json({ error: "Nothing exists at that path" }, 404);
    }
    const allowed = await options.server.allowsPath(path);
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
    const failed = await options.writer.apply(c, {
      ...config,
      vhostSites: [
        ...(config.vhostSites ?? []),
        {
          name,
          path,
          public: body.public === true,
          ...(body.password ? { password: body.password } : {}),
        },
      ],
    });
    if (failed) return failed;
    const site = options.server.config.vhostSites?.find(
      (row) => row.name === name,
    );
    if (!site) return c.json({ error: "Vhost was not saved" }, 500);
    return c.json(await siteView(site));
  });

  routes.delete("/artifacts/vhost-sites/:name", async (c) => {
    const config = options.server.config;
    const site = config.vhostSites?.find(
      (row) => row.name === c.req.param("name"),
    );
    if (!site) return c.json({ error: "Unknown vhost" }, 404);
    const failed = await options.writer.apply(c, {
      ...config,
      vhostSites: config.vhostSites?.filter((row) => row !== site),
    });
    if (failed) return failed;
    // A later claim of this name and path must not revive old private links.
    await options.server.vhostAccess.rotate(site);
    return c.json({ success: true });
  });

  return routes;
}
