import { Hono } from "hono";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";

export function createVhostAccessRoutes(server: ArtifactServer) {
  const routes = new Hono();
  const rows = () => [
    ...(server.config.vhosts ?? []),
    ...(server.config.vhostSites ?? []),
  ];
  routes.get("/artifacts/vhosts/links", async (c) => {
    await server.ready;
    return c.json({
      tokens: Object.fromEntries(
        rows().map((row) => [
          row.name,
          row.public ? null : server.vhostAccess.token(row),
        ]),
      ),
    });
  });
  routes.post("/artifacts/vhosts/:name/revoke", async (c) => {
    const row = rows().find((row) => row.name === c.req.param("name"));
    if (!row) return c.json({ error: "Unknown app" }, 404);
    await server.vhostAccess.rotate(row);
    return c.json({ revoked: true });
  });
  return routes;
}
