import {
  FILE_VIEW_MAX_PART_LENGTH,
  FILE_VIEW_MAX_PARTS,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { PRINCIPAL_VARIABLE, type Principal } from "../auth/principal.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { ProjectFileCompletion } from "../services/projectFileCompletion.js";
import {
  FileViewSearchError,
  searchFileView,
} from "../services/projectFileViewSearch.js";
import { createLocalResourcePathPolicy } from "./local-resource-policy.js";
import { resolveProjectPath } from "./projectParam.js";

/**
 * `GET /api/projects/:projectId/file-view-search?part=…&part=…` resolves the
 * parts of a `/v` command to files (`topics/view-command.md`). Project paths
 * need only project access; naming a host path outside the project is
 * superuser-only and passes the file endpoint's allow-set check.
 */
export function createProjectFileViewSearchRoutes(deps: {
  scanner: ProjectScanner;
  service: ProjectFileCompletion;
  allowedPaths?: string[] | (() => string[]);
  includeProjects?: () => boolean;
}) {
  const routes = new Hono<{
    Variables: Record<typeof PRINCIPAL_VARIABLE, Principal>;
  }>();
  const pathPolicy =
    deps.allowedPaths !== undefined
      ? createLocalResourcePathPolicy({
          allowedPaths: deps.allowedPaths,
          scanner: deps.scanner,
          includeProjects: deps.includeProjects,
        })
      : undefined;

  routes.get("/:projectId/file-view-search", async (c) => {
    const project = await resolveProjectPath(c, deps.scanner);
    if (typeof project !== "string") return project;
    const parts = c.req.queries("part") ?? [];
    const recent = c.req.queries("recent") ?? [];
    if (
      parts.length > FILE_VIEW_MAX_PARTS ||
      parts.some((part) => !part || part.length > FILE_VIEW_MAX_PART_LENGTH) ||
      recent.length > 100 ||
      recent.some((path) => path.length > 4096)
    )
      return c.json({ error: "Invalid file view query" }, 400);
    const principal = c.get(PRINCIPAL_VARIABLE) as Principal | undefined;
    const access =
      pathPolicy && (!principal || principal.kind === "superuser")
        ? pathPolicy
        : null;
    try {
      return c.json(
        await searchFileView(
          deps.service,
          project,
          { parts, recent, includeIgnored: c.req.query("ignored") === "1" },
          access,
        ),
      );
    } catch (error) {
      if (error instanceof FileViewSearchError)
        return c.json({ error: error.message }, error.status);
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "File view search failed",
        },
        503,
      );
    }
  });
  return routes;
}
