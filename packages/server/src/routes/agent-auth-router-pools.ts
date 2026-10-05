import type { Hono } from "hono";
import type { AgentAuthRouter } from "../services/AgentAuthRouter.js";

/** Uses the same owner-only administration namespace and safe error handler. */
export function registerAgentAuthRouterPoolRoutes(
  routes: Hono,
  router: AgentAuthRouter,
) {
  routes.post("/agent-auth-router/overview", async (c) =>
    c.json(await router.overview(await c.req.json())),
  );
  routes.post("/agent-auth-router/overview/refresh", async (c) =>
    c.json(await router.refreshOverview(await c.req.json())),
  );
  routes.post("/agent-auth-router/pools/save", async (c) =>
    c.json(await router.savePool(await c.req.json())),
  );
  routes.post("/agent-auth-router/pools/remove", async (c) =>
    c.json(await router.removePool(await c.req.json())),
  );
}
