import { Hono } from "hono";
import type { VocabularyLearning } from "../services/voice/VocabularyLearning.js";

export function createSpeechVocabularyRoutes(
  learning: VocabularyLearning,
): Hono {
  const routes = new Hono();
  routes.get("/vocabulary", (c) =>
    c.json(learning.status(c.req.query("includeWords") === "1")),
  );
  routes.put("/vocabulary", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object")
      return c.json({ error: "Expected vocabulary settings" }, 400);
    const { enabled, biasing, hours, sessionMultiplier, sessionShare } =
      body as Record<string, unknown>;
    // Zero means collect from now on, fractions are ordinary, and there is no
    // upper limit: 8760 is only how far the slider's track reaches.
    if (
      typeof enabled !== "boolean" ||
      typeof biasing !== "boolean" ||
      typeof hours !== "number" ||
      !Number.isFinite(hours) ||
      hours < 0
    ) {
      return c.json(
        { error: "Expected enabled, biasing, and hours of zero or more" },
        400,
      );
    }
    // Absent means unchanged: an older client that does not know these fields
    // must not reset them by saving the rest of the form.
    const current = learning.store.settings();
    const multiplier = sessionMultiplier ?? current.sessionMultiplier;
    const share = sessionShare ?? current.sessionShare;
    if (
      typeof multiplier !== "number" ||
      !Number.isFinite(multiplier) ||
      multiplier < 0 ||
      typeof share !== "number" ||
      !Number.isFinite(share) ||
      share < 0 ||
      share > 1
    ) {
      return c.json(
        {
          error:
            "Expected sessionMultiplier of zero or more and sessionShare between 0 and 1",
        },
        400,
      );
    }
    learning.configure({
      enabled,
      biasing,
      hours,
      sessionMultiplier: multiplier,
      sessionShare: share,
    });
    return c.json(learning.status());
  });
  routes.post("/vocabulary/scan", (c) => {
    if (!learning.store.settings().enabled)
      return c.json({ error: "Enable learning before scanning" }, 409);
    learning.scan();
    return c.json(learning.status(), 202);
  });
  routes.post("/vocabulary/reset", async (c) => {
    await learning.reset();
    return c.json(learning.status());
  });
  return routes;
}
