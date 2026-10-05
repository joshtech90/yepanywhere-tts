import { Hono } from "hono";
import { getLogger } from "../logging/logger.js";
import type { Supervisor } from "../supervisor/Supervisor.js";

export interface ContextBreakdownRoutesDeps {
  supervisor: Pick<Supervisor, "getProcessForSession">;
}

/**
 * `GET /api/sessions/:sessionId/context-breakdown` — what fills the session's
 * context window, by category, for the context-usage popover.
 *
 * `breakdown` is null when no live process owns the session or its provider
 * cannot report one; the popover then omits the section. A provider failure
 * is a 502 carrying the provider's message.
 */
export function createContextBreakdownRoutes(
  deps: ContextBreakdownRoutesDeps,
): Hono {
  const routes = new Hono();

  routes.get("/:sessionId/context-breakdown", async (c) => {
    const sessionId = c.req.param("sessionId");
    const process = deps.supervisor.getProcessForSession(sessionId);
    if (!process) {
      return c.json({ breakdown: null });
    }
    try {
      return c.json({ breakdown: await process.getContextBreakdown() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().warn(
        { event: "context_breakdown_failed", sessionId, error: message },
        "CONTEXT_BREAKDOWN: provider request failed",
      );
      return c.json({ error: message }, 502);
    }
  });

  return routes;
}
