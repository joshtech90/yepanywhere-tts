import { Hono } from "hono";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { EventBus } from "../watcher/EventBus.js";

/** Coupled Android runtime only; mounted behind the ordinary owner API auth. */
export function createAndroidHostSummaryRoutes(deps: {
  supervisor: Pick<Supervisor, "getProcessInfoList">;
  eventBus: EventBus;
}): Hono {
  const routes = new Hono();
  // One native service normally connects. Bound duplicate/reconnecting consumers.
  let consumers = 0;
  routes.get("/summary", (c) => {
    if (consumers >= 4)
      return c.json({ error: "Too many host observers" }, 429);
    consumers++;
    const encoder = new TextEncoder();
    let dispose = () => {};
    let drain = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let queued = false;
        let latest: string | undefined;
        let previous: string | undefined;
        const flush = () => {
          if (
            closed ||
            latest === undefined ||
            (controller.desiredSize ?? 0) <= 0
          )
            return;
          const value = latest;
          latest = undefined;
          controller.enqueue(encoder.encode(`data: ${value}\n\n`));
        };
        const update = () => {
          if (closed || queued) return;
          queued = true;
          queueMicrotask(() => {
            queued = false;
            if (closed) return;
            let working = 0;
            let attention = 0;
            for (const process of deps.supervisor.getProcessInfoList()) {
              if (process.state === "in-turn") working++;
              if (process.state === "waiting-input") attention++;
            }
            const next = JSON.stringify({ working, attention });
            if (next === previous) return;
            previous = next;
            latest = next;
            flush();
          });
        };
        const unsubscribe = deps.eventBus.subscribe((event) => {
          if (
            event.type === "process-state-changed" ||
            event.type === "session-status-changed" ||
            event.type === "session-created" ||
            event.type === "process-terminated"
          )
            update();
        });
        // Heartbeat checks transport liveness, never samples sessions or files.
        const heartbeat = setInterval(() => {
          if (
            !closed &&
            latest === undefined &&
            (controller.desiredSize ?? 0) > 0
          )
            controller.enqueue(encoder.encode(": alive\n\n"));
        }, 15000);
        dispose = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          c.req.raw.signal.removeEventListener("abort", dispose);
          consumers--;
          try {
            controller.close();
          } catch {
            /* A cancelled reader already closed it. */
          }
        };
        c.req.raw.signal.addEventListener("abort", dispose, { once: true });
        // pull uses this same bounded latest-value slot; no per-event queue.
        drain = flush;
        if (c.req.raw.signal.aborted) dispose();
        else update();
      },
      pull() {
        drain();
      },
      cancel() {
        dispose();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  });
  return routes;
}
