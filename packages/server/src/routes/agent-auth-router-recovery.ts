import type { Hono } from "hono";
import type { AgentAuthRouter } from "../services/AgentAuthRouter.js";

/** Registered under the router administration namespace and its error handler. */
export function registerAgentAuthRouterRecoveryRoutes(
  routes: Hono,
  router: AgentAuthRouter,
) {
  routes.get("/agent-auth-router/recovery", async (c) =>
    c.json(await router.recovery()),
  );
  routes.post("/agent-auth-router/retry-cancellations", async (c) =>
    c.json(await router.retryCancellations()),
  );
}
