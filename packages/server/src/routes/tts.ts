import { Hono } from "hono";
import { getLogger } from "../logging/logger.js";
import type { TtsService } from "../services/TtsService.js";

const logger = getLogger();

interface TtsDeps {
  ttsService: TtsService;
}

/**
 * Text-to-speech routes. Mounted at /api/tts.
 *
 * Separate from /api/speech (which is speech-to-text / transcription).
 */
export function createTtsRoutes(deps: TtsDeps): Hono {
  const routes = new Hono();
  const { ttsService } = deps;

  routes.get("/status", (c) => {
    return c.json(ttsService.getStatus());
  });

  routes.post("/synthesize", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const text = obj.text;
    const wantsBase64 = obj.format === "base64";
    if (typeof text !== "string" || text.trim().length === 0) {
      return c.json({ error: "text is required" }, 400);
    }

    try {
      const audio = await ttsService.synthesize(text);
      // base64 JSON variant: survives the encrypted relay channel used by
      // remote (phone) clients, which only carries JSON.
      if (wantsBase64) {
        return c.json({ audioBase64: audio.toString("base64") });
      }
      const bytes = new Uint8Array(audio.byteLength);
      bytes.set(audio);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": audio.length.toString(),
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ component: "tts", err: message }, "TTS synthesis failed");
      return c.json({ error: message }, 500);
    }
  });

  return routes;
}
