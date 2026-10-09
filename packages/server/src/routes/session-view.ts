import { parseSessionViewPublication } from "@yep-anywhere/shared";
import { Hono } from "hono";
import type { SessionViewRegistry } from "../services/SessionViewRegistry.js";

export interface SessionViewRoutesDeps {
  sessionViews: Pick<SessionViewRegistry, "publish" | "depart">;
}

/**
 * A tab reports what it shows beside a session, or that it left it.
 * Contract: topics/agent-self.md § View inspection. Mounted only while agent
 * self inspection is enabled, which is also when the capability is advertised.
 */
export function createSessionViewRoutes(deps: SessionViewRoutesDeps): Hono {
  const routes = new Hono();

  routes.put("/:sessionId/view", async (c) => {
    const publication = parseSessionViewPublication(
      await c.req.json().catch(() => null),
    );
    if (!publication) return c.json({ error: "Invalid session view" }, 400);
    deps.sessionViews.publish(c.req.param("sessionId"), publication);
    return c.json({ ok: true });
  });

  routes.delete("/:sessionId/view/:clientId", (c) => {
    deps.sessionViews.depart(c.req.param("sessionId"), c.req.param("clientId"));
    return c.json({ ok: true });
  });

  return routes;
}
