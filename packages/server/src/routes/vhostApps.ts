import { Hono } from "hono";
import type { VhostAppControl } from "../artifacts/VhostAppControl.js";

export function createVhostAppRoutes(control: VhostAppControl) {
  const routes = new Hono();
  routes.get("/artifacts/vhosts/:name/listener", async (c) => {
    try {
      return c.json(await control.identify(c.req.param("name")));
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });
  routes.post("/artifacts/vhosts/:name/stop", async (c) => {
    const body = await c.req.json<{ token?: unknown } | null>();
    if (!body || (body.token !== null && typeof body.token !== "string"))
      return c.json({ error: "Expected listener token" }, 400);
    try {
      await control.stop(c.req.param("name"), body.token);
      return c.json({ stopped: true });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });
  return routes;
}
