import { Hono } from "hono";
import type { ProjectScanner } from "../projects/scanner.js";
import { ProjectFileCompletion } from "../services/projectFileCompletion.js";
import { resolveProjectPath } from "./projectParam.js";

export function createProjectFileCompletionRoutes(deps: {
  scanner: ProjectScanner;
  dataDir: string;
  service?: ProjectFileCompletion;
}): Hono {
  const routes = new Hono();
  const service = deps.service ?? new ProjectFileCompletion(deps.dataDir);
  routes.get("/:projectId/file-completion", async (c) => {
    const project = await resolveProjectPath(c, deps.scanner);
    if (typeof project !== "string") return project;
    const query = c.req.query("q") ?? "";
    const recent = c.req.queries("recent") ?? [];
    if (
      query.length > 256 ||
      /\s/.test(query) ||
      recent.length > 100 ||
      recent.some((path) => path.length > 4096)
    )
      return c.json({ error: "Invalid file completion query" }, 400);
    try {
      return c.json(await service.query(project, query, recent));
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "File completion failed",
        },
        503,
      );
    }
  });
  return routes;
}
