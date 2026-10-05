import { realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  projectAccessLevel,
  type LimitedUserGrants,
  type ArtifactVhostSiteView,
} from "@yep-anywhere/shared";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { principalFor } from "../auth/limitedLaunchPolicy.js";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import type { ArtifactVhostSite } from "../artifacts/config.js";
import { APP_ACCESS_QUERY } from "../artifacts/VhostAccess.js";
import { clientVhostSite, configuredVhostNames } from "../artifacts/vhosts.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import type { ArtifactConfigWriter } from "./artifactConfigWriter.js";
import { isPathInsideDirectory } from "./local-resource-policy.js";
import type { ArtifactConfig } from "../artifacts/config.js";

/** Most linked paths a row's view names; Settings shows those that fit. */
const LINKED_FILE_SAMPLE = 40;

/**
 * Owner routes for file vhosts: list a file's rows, claim a name, release it.
 * Every change goes through the shared configuration writer, so it is saved
 * exactly as a Settings edit would be.
 */
export function createVhostSiteRoutes(options: {
  server: ArtifactServer;
  scanner: Pick<ProjectScanner, "getProject">;
  writer: ArtifactConfigWriter;
  activeGrants?: (username: string) => LimitedUserGrants | null | undefined;
}) {
  const routes = new Hono();

  function authorize(c: Context, projectId: unknown, privateLink = false) {
    const principal = principalFor(c);
    if (principal.kind === "superuser") return;
    const grants = options.activeGrants?.(principal.username);
    if (
      grants?.allowPublicApps !== true ||
      (privateLink && grants.allowPrivateAppLinks === false)
    )
      throw new HTTPException(403, {
        message: "Publishing file addresses is not allowed",
      });
    if (
      typeof projectId !== "string" ||
      projectAccessLevel(grants, projectId) !== "new-session"
    )
      throw new HTTPException(404, { message: "Project not found" });
  }

  function authorizeOwner(c: Context, site: ArtifactVhostSite) {
    const principal = principalFor(c);
    if (
      principal.kind === "limited" &&
      site.ownerUsername !== principal.username
    )
      throw new HTTPException(403, {
        message: "You may replace or release only your own file addresses",
      });
  }

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
      ...(kind === "file"
        ? { linkedFiles: await linkedFiles(site.path, site.projectRoot) }
        : {}),
    };
  }

  /** How many files a file row serves, and the first of them by name. */
  async function linkedFiles(path: string, projectRoot?: string) {
    const site = await options.server.linkedSite(path, projectRoot);
    const folder = dirname(site.files[0]?.path ?? path);
    return {
      count: site.files.length,
      paths: site.files
        .slice(0, LINKED_FILE_SAMPLE)
        .map((file) => relative(folder, file.path)),
      truncated: site.truncated,
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
    authorize(c, c.req.query("projectId"));
    const path = c.req.query("path");
    const wanted = path
      ? await absolutePath(path, c.req.query("projectId"))
      : undefined;
    if (wanted === null) return c.json({ error: "Project not found" }, 404);
    const principal = principalFor(c);
    const allowPrivateLinks =
      principal.kind === "superuser" ||
      options.activeGrants?.(principal.username)?.allowPrivateAppLinks !==
        false;
    const sites = (options.server.config.vhostSites ?? []).filter(
      (site) =>
        (site.public || allowPrivateLinks) &&
        (wanted === undefined || site.path === wanted) &&
        (principal.kind === "superuser" ||
          (site.ownerUsername === principal.username &&
            site.projectId === c.req.query("projectId"))),
    );
    return c.json({ sites: await Promise.all(sites.map(siteView)) });
  });

  // Read the current rows inside the writer, after asynchronous path checks.
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
      (body.replace !== undefined && typeof body.replace !== "boolean") ||
      (body.password !== undefined && typeof body.password !== "string")
    )
      return c.json({ error: "Expected name, path and optional public" }, 400);
    const name = body.name.trim().toLowerCase();
    authorize(c, body.projectId, body.public !== true);
    const path = await absolutePath(body.path, body.projectId);
    if (path === null) return c.json({ error: "Project not found" }, 404);
    const principal = principalFor(c);
    let projectRoot: string | undefined;
    try {
      await stat(path);
    } catch {
      return c.json({ error: "Nothing exists at that path" }, 404);
    }
    if (principal.kind === "limited") {
      const project = await options.scanner.getProject(
        body.projectId as string,
      );
      if (!project) return c.json({ error: "Project not found" }, 404);
      projectRoot = await realpath(project.path);
      const canonical = await realpath(path);
      if (
        canonical !== projectRoot &&
        !isPathInsideDirectory(canonical, projectRoot)
      )
        return c.json({ error: "File is outside this project" }, 403);
    }
    const allowed = await options.server.allowsPath(path);
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
    let replaced: ArtifactVhostSite | undefined;
    let saved: ArtifactVhostSiteView | undefined;
    const failed = await options.writer.apply(
      c,
      (config: ArtifactConfig) => {
        authorize(c, body.projectId, body.public !== true);
        replaced = config.vhostSites?.find((site) => site.name === name);
        if (replaced && body.replace === true) authorizeOwner(c, replaced);
        if (
          configuredVhostNames(config).includes(name) &&
          (!replaced || body.replace !== true)
        )
          throw new HTTPException(409, {
            message: `The name "${name}" is already taken`,
          });
        return {
          ...config,
          vhostSites: [
            ...(config.vhostSites ?? []).filter((site) => site.name !== name),
            {
              name,
              path,
              public: body.public === true,
              password: body.password ?? "",
              ...(principal.kind === "limited"
                ? {
                    ownerUsername: principal.username,
                    projectId: body.projectId,
                    projectRoot,
                  }
                : {}),
            },
          ],
        };
      },
      async (config) => {
        // Keep link revocation and the returned owner's view under the writer
        // lock: a later replacement must not supply this request's bearer URL.
        if (replaced) await options.server.vhostAccess.rotate(replaced);
        const site = config.vhostSites?.find((row) => row.name === name);
        if (!site) throw new Error("Vhost was not saved");
        saved = await siteView(site);
      },
    );
    if (failed) return failed;
    return c.json(saved);
  });

  routes.delete("/artifacts/vhost-sites/:name", async (c) => {
    let site: ArtifactVhostSite | undefined;
    const failed = await options.writer.apply(
      c,
      (config: ArtifactConfig) => {
        site = config.vhostSites?.find(
          (row) => row.name === c.req.param("name"),
        );
        if (!site) throw new HTTPException(404, { message: "Unknown vhost" });
        authorizeOwner(c, site);
        authorize(c, site.projectId);
        return {
          ...config,
          vhostSites: config.vhostSites?.filter((row) => row !== site),
        };
      },
      async () => {
        // A later claim of this name and path must not revive old private links.
        await options.server.vhostAccess.rotate(site!);
      },
    );
    if (failed) return failed;
    return c.json({ success: true });
  });

  return routes;
}
