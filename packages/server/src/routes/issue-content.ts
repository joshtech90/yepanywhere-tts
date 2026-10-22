import { Hono } from "hono";
import type { IssueStore } from "../services/issues/IssueStore.js";
import type { IssueContentRefresher } from "../services/issues/content.js";

/** Negotiated by contentRefresh, not promised by the original discovery bit. */
export function createIssueContentRoutes(
  store: IssueStore,
  content?: IssueContentRefresher,
) {
  const routes = new Hono();
  routes.post("/issues/refresh", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.force !== "boolean" ||
      (body.id !== undefined &&
        (typeof body.id !== "string" || body.id.length > 4096))
    )
      return c.json({ error: "Expected force and optional issue id" }, 400);
    if (!content) return c.json({ error: "Content refresh unavailable" }, 503);
    content.start(body.force, body.id);
    return c.json(content.status(), 202);
  });
  routes.get("/issues/content", (c) => {
    const id = c.req.query("id");
    if (!id || id.length > 4096)
      return c.json({ error: "Expected issue id" }, 400);
    return c.json({ content: store.content(id) });
  });
  return routes;
}
