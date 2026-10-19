import { Hono } from "hono";
import type { IssueStatusRefresher } from "../services/issues/status.js";

/** Kept separate from the original issue capability's route ownership. */
export function createIssueStatusRoutes(statuses?: IssueStatusRefresher) {
  const routes = new Hono();
  routes.delete("/issues/status", (c) => {
    if (!statuses)
      return c.json({ error: "Tracker status is unavailable" }, 503);
    statuses.clear();
    return c.json({ ok: true });
  });
  return routes;
}
