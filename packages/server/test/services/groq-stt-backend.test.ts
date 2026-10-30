import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGroqApiKeys } from "../../src/services/voice/groqApiKeys.js";
import { GroqSttBackend } from "../../src/services/voice/groqSttBackend.js";
import { initSpeechBackendRegistry } from "../../src/services/voice/registry.js";

function recordingFetch(statuses: Record<string, number[]>) {
  const calls: Array<{ key: string; form: FormData }> = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const key = String(
      (init?.headers as Record<string, string> | undefined)?.Authorization,
    ).replace("Bearer ", "");
    calls.push({ key, form: init?.body as FormData });
    const status = statuses[key]?.shift() ?? 200;
    return status === 200
      ? new Response(JSON.stringify({ text: ` hallo von ${key} ` }), {
          status,
        })
      : new Response("limited", {
          status,
          headers: status === 429 ? { "retry-after": "120" } : {},
        });
  }) as typeof fetch;
  return { calls, impl };
}

describe("GroqSttBackend", () => {
  it("hands a rate-limited or rejected key's request to the next key and rests it", async () => {
    const { calls, impl } = recordingFetch({ a: [429], b: [401] });
    const backend = new GroqSttBackend(["a", "b", "c"], "de", impl);

    const texts = new Set<string>();
    for (let i = 0; i < 6; i++) {
      texts.add(
        await backend.transcribe(Buffer.from("audio"), {
          mimeType: "audio/mp4",
        }),
      );
    }

    // Every request ends on a working key, and the 429 key is not retried
    // while it rests; the 401 key only failed once because its queue drained.
    expect([...texts].every((text) => text.startsWith("hallo von"))).toBe(true);
    expect(calls.filter((call) => call.key === "a")).toHaveLength(1);
    const form = calls[0]!.form;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("de");
    expect((form.get("file") as File).name).toBe("audio.m4a");
  });

  it("reports the last Groq error when every key fails", async () => {
    const { impl } = recordingFetch({ a: [429], b: [403] });
    const backend = new GroqSttBackend(["a", "b"], undefined, impl);

    await expect(backend.transcribe(Buffer.from("audio"))).rejects.toThrow(
      /Groq transcription failed \(HTTP (429|403)\)/,
    );
  });

  it("leaves resting keys alone instead of retrying them at once", async () => {
    const { calls, impl } = recordingFetch({ a: [429] });
    const backend = new GroqSttBackend(["a"], undefined, impl);

    await expect(backend.transcribe(Buffer.from("audio"))).rejects.toThrow(
      /HTTP 429/,
    );
    await expect(backend.transcribe(Buffer.from("audio"))).rejects.toThrow(
      /rate-limited; try again in 120 s/,
    );
    expect(calls).toHaveLength(1);
  });

  it("masks pool keys in Groq's error text", async () => {
    const impl = (async () =>
      new Response(
        JSON.stringify({ error: { message: "Invalid API Key gsk_secret1" } }),
        { status: 400 },
      )) as typeof fetch;
    const backend = new GroqSttBackend(["gsk_secret1"], undefined, impl);

    const failure = await backend
      .transcribe(Buffer.from("audio"))
      .catch((error: Error) => error.message);
    expect(failure).toBe(
      "Groq transcription failed (HTTP 400): Invalid API Key [key]",
    );
  });

  it("does not try further keys on a request error", async () => {
    const { calls, impl } = recordingFetch({ a: [400], b: [400] });
    const backend = new GroqSttBackend(["a", "b"], undefined, impl);

    await expect(backend.transcribe(Buffer.from("audio"))).rejects.toThrow(
      /HTTP 400/,
    );
    expect(calls).toHaveLength(1);
  });
});

describe("Groq key pool", () => {
  it("merges inline keys and key files, skipping comments, dupes and absent files", () => {
    const dir = mkdtempSync(join(tmpdir(), "groq-keys-"));
    const pool = join(dir, "pool.txt");
    writeFileSync(pool, "# Konten\nk2\n\nk3\nk1\n");

    expect(loadGroqApiKeys("k1, k2", [pool, join(dir, "fehlt.txt")])).toEqual([
      "k1",
      "k2",
      "k3",
    ]);
  });

  it("auto-enables ya-groq when the pool is non-empty", async () => {
    const registry = await initSpeechBackendRegistry({
      voiceInputEnabled: true,
      groqApiKeys: ["k1"],
    });
    await registry.waitForValidation();
    expect(registry.enabledIds()).toEqual(["ya-groq"]);

    const empty = await initSpeechBackendRegistry({
      voiceInputEnabled: true,
      groqApiKeys: [],
    });
    expect(empty.knownIds()).toEqual([]);
  });
});
