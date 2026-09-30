import {
  isUrlProjectId,
  pathGrantLevel,
  projectAccessLevel,
  type ProjectAccessEntry,
} from "@yep-anywhere/shared";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { LimitedUsersService } from "../auth/LimitedUsersService.js";
import { principalFor } from "../auth/limitedLaunchPolicy.js";
import type { ProjectMetadataService } from "../metadata/ProjectMetadataService.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { createProjectCopyRoutes } from "./project-copy.js";

const setRequest = z.strictObject({
  username: z.string().min(1),
  level: z.enum(["none", "view", "join", "new-session"]),
});

/**
 * Sharing one project with limited users, from the project's own settings.
 *
 * Contract: topics/limited-users.md § Project sharing. The superuser may
 * share any project; a limited user only a project they created, and only
 * with other limited users. Every level is theirs to give, the same grants
 * Settings → Users edits, so the superuser sees and may revoke them there.
 */
export function createProjectAccessRoutes(deps: {
  scanner: Pick<ProjectScanner, "getProject">;
  limitedUsers: LimitedUsersService;
  metadata: Pick<ProjectMetadataService, "getProjectOwner">;
}) {
  const routes = new Hono();

  /** The project, if this principal may share it; 404 otherwise. */
  const sharable = async (c: Context) => {
    const projectId = c.req.param("projectId");
    if (!projectId || !isUrlProjectId(projectId))
      throw new HTTPException(404, { message: "Project not found" });
    const project = await deps.scanner.getProject(projectId);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    const principal = principalFor(c);
    const owner = deps.metadata.getProjectOwner(project.path);
    if (principal.kind === "limited" && principal.username !== owner)
      // Existence is already known to anyone the middleware let this far;
      // refusing plainly tells them why there is no sharing panel.
      throw new HTTPException(403, {
        message: "Only the project's creator or the owner may share it",
      });
    return { project, owner };
  };

  routes.get("/projects/:projectId/access", async (c) => {
    const { project, owner } = await sharable(c);
    const users: ProjectAccessEntry[] = deps.limitedUsers
      .list()
      .filter((user) => user.username !== owner)
      .map((user) => ({
        username: user.username,
        level: projectAccessLevel({ ...user, pathGrants: [] }, project.id),
        directoryLevel: pathGrantLevel(user, project.path),
      }));
    return c.json({ users });
  });

  routes.put("/projects/:projectId/access", async (c) => {
    const { project, owner } = await sharable(c);
    const parsed = setRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Expected a username and level" }, 400);
    const { username, level } = parsed.data;
    if (username === owner)
      return c.json({ error: "The creator's own access is not shared" }, 400);
    if (!deps.limitedUsers.get(username))
      return c.json({ error: "User not found" }, 404);
    // Grants are read again on every request, so this applies at once.
    await deps.limitedUsers.setProjectLevel(username, project.id, level);
    return c.json({ username, level });
  });

  // Copying is the other half of reaching someone else's project; mounted
  // here so both share one registration point in the app.
  routes.route("/", createProjectCopyRoutes({ scanner: deps.scanner }));

  return routes;
}
