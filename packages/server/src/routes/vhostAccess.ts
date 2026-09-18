import { Hono } from "hono";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";

export function createVhostAccessRoutes(server: ArtifactServer) {
  const routes = new Hono();
  routes.get("/artifacts/vhosts/links", async (c) => {
    await server.ready;
    return c.json({
      tokens: Object.fromEntries(
        (server.config.vhosts ?? []).map((row) => [
          row.name,
          row.public ? null : server.vhostAccess.token(row),
        ]),
      ),
    });
  });
  routes.post("/artifacts/vhosts/:name/revoke", async (c) => {
    const row = server.config.vhosts?.find(
      (row) => row.name === c.req.param("name"),
    );
    if (!row) return c.json({ error: "Unknown app" }, 404);
    await server.vhostAccess.rotate(row);
    return c.json({ revoked: true });
  });
  return routes;
}
