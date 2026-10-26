import { Hono } from "hono";
import { principalFor } from "../auth/limitedLaunchPolicy.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { RendezCompose } from "../services/RendezCompose.js";

export function createRendezComposeRoutes(
  compose: RendezCompose,
  scanner: ProjectScanner,
): Hono {
  const routes = new Hono();
  routes.post("/compose", async (c) => {
    if (principalFor(c).kind !== "superuser")
      return c.json({ error: "Rendez compose requires the server owner" }, 403);
    const body = await c.req.json();
    if (
      !body ||
      typeof body.claimId !== "string" ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(body.claimId) ||
      typeof body.acquire !== "boolean" ||
      (body.projectId !== null && typeof body.projectId !== "string")
    )
      return c.json({ error: "Invalid rendez compose claim" }, 400);
    const project =
      body.projectId === null
        ? undefined
        : await scanner.getProject(body.projectId);
    if (body.projectId !== null && !project)
      return c.json({ error: "Project not found" }, 404);
    const active = await compose.update(
      body.claimId,
      project?.path,
      body.acquire,
    );
    return c.json({ active });
  });
  return routes;
}
