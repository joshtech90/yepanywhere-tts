import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "../../src/services/ttsChunking.js";

describe("splitIntoChunks", () => {
  it("splits a long unbroken token quickly and without losing text", () => {
    // A hash or blob without spaces or punctuation, at the Gemini text limit.
    // Chunking runs on the request thread; the old per-character rejoin took
    // seconds here and stalled every other session meanwhile.
    const token = "abcdefghiäöü".repeat(1667).slice(0, 20_000);
    const started = performance.now();
    const chunks = splitIntoChunks(token);
    const elapsedMs = performance.now() - started;

    expect(chunks.join("")).toBe(token);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
      expect(Buffer.byteLength(chunk, "utf-8")).toBeLessThanOrEqual(3800);
    }
    expect(elapsedMs).toBeLessThan(1000);
  });
});
