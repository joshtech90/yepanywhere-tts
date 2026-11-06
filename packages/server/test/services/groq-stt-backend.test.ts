import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGroqApiKeys } from "../../src/services/voice/groqApiKeys.js";
import {
  grokWebFallback,
  isSilentRecording,
} from "../../src/services/voice/grokWebStt.js";
import { GroqSttBackend } from "../../src/services/voice/groqSttBackend.js";
import { initSpeechBackendRegistry } from "../../src/services/voice/registry.js";

const noFallback = async () => {
  throw new Error("Grok down");
};
const notSilent = async () => false;

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
    const backend = new GroqSttBackend(
      ["a", "b", "c"],
      "de",
      impl,
      noFallback,
      notSilent,
    );

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
    const backend = new GroqSttBackend(
      ["a", "b"],
      undefined,
      impl,
      noFallback,
      notSilent,
    );

    await expect(backend.transcribe(Buffer.from("audio"))).rejects.toThrow(
      /Groq transcription failed \(HTTP (429|403)\)/,
    );
  });

  it("leaves resting keys alone instead of retrying them at once", async () => {
    const { calls, impl } = recordingFetch({ a: [429] });
    const backend = new GroqSttBackend(
      ["a"],
      undefined,
      impl,
      noFallback,
      notSilent,
    );

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
    const backend = new GroqSttBackend(
      ["gsk_secret1"],
      undefined,
      impl,
      noFallback,
      notSilent,
    );

    const failure = await backend
      .transcribe(Buffer.from("audio"))
      .catch((error: Error) => error.message);
    expect(failure).toBe(
      "Groq transcription failed (HTTP 400): Invalid API Key [key]; Grok down",
    );
  });

  it("does not try further keys on a request error", async () => {
    const { calls, impl } = recordingFetch({ a: [400], b: [400] });
    const backend = new GroqSttBackend(
      ["a", "b"],
      undefined,
      impl,
      noFallback,
      notSilent,
    );

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

describe("GroqSttBackend stand-in", () => {
  const down = (async () =>
    new Response("boom", { status: 500 })) as typeof fetch;
  const hangs = (async () => {
    throw new DOMException("timed out", "TimeoutError");
  }) as typeof fetch;

  it("keeps Groq alone when it answers", async () => {
    const { impl } = recordingFetch({});
    let asked = 0;
    const backend = new GroqSttBackend(
      ["a"],
      "de",
      impl,
      async () => {
        asked += 1;
        return "nein";
      },
      notSilent,
    );
    expect(await backend.transcribe(Buffer.from("audio"))).toBe("hallo von a");
    expect(asked).toBe(0);
  });

  it.each([
    ["5xx", down],
    ["timeout", hangs],
  ])("asks Grok once after a Groq %s and names it", async (_name, impl) => {
    let asked = 0;
    const backend = new GroqSttBackend(
      ["a", "b"],
      "de",
      impl,
      async () => {
        asked += 1;
        return "von Grok";
      },
      notSilent,
    );
    expect(await backend.transcribe(Buffer.from("audio"))).toBe(
      "(abgeschrieben von Grok) von Grok",
    );
    expect(asked).toBe(1);
  });

  it("asks Grok when every Groq key is rate-limited", async () => {
    const { impl } = recordingFetch({ a: [429] });
    const backend = new GroqSttBackend(
      ["a"],
      "de",
      impl,
      async () => "von Grok",
      notSilent,
    );
    expect(await backend.transcribe(Buffer.from("audio"))).toContain(
      "von Grok",
    );
  });

  it("reports both reasons when both fail and leaks no key", async () => {
    const leaky = (async () =>
      new Response("gsk_geheim", { status: 500 })) as typeof fetch;
    const backend = new GroqSttBackend(
      ["gsk_geheim"],
      "de",
      leaky,
      noFallback,
      notSilent,
    );
    await expect(backend.transcribe(Buffer.from("audio"))).rejects.toThrow(
      /Grok down/,
    );
    await expect(backend.transcribe(Buffer.from("audio"))).rejects.not.toThrow(
      /gsk_geheim/,
    );
  });

  it("asks nobody for a silent recording", async () => {
    let calls = 0;
    const counted = (async () => {
      calls += 1;
      return new Response("{}");
    }) as typeof fetch;
    const backend = new GroqSttBackend(
      ["a"],
      "de",
      counted,
      noFallback,
      async () => true,
    );
    expect(await backend.transcribe(Buffer.from("audio"))).toBe("");
    expect(calls).toBe(0);
  });
});

describe("grokWebFallback", () => {
  it("posts the raw audio with the token and bare MIME type", async () => {
    const folder = mkdtempSync(join(tmpdir(), "grok-token-"));
    const tokenFile = join(folder, "token");
    writeFileSync(tokenFile, "geheim\n");
    let seen: { url: string; init?: RequestInit } | undefined;
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ text: " hallo " }));
    }) as typeof fetch;
    const call = grokWebFallback(impl, {
      TTS_GROK_URL: "http://grok:8812/",
      TTS_GROK_TOKEN_FILE: tokenFile,
    });
    expect(
      await call(Buffer.from("audio"), { mimeType: "audio/webm;codecs=opus" }),
    ).toBe("hallo");
    expect(seen?.url).toBe("http://grok:8812/stt");
    expect(seen?.init?.headers).toEqual({
      "Content-Type": "audio/webm",
      Authorization: "Bearer geheim",
    });
  });

  it("treats 422 as no speech and throws on other errors", async () => {
    const env = { TTS_GROK_TOKEN_FILE: "/nonexistent" };
    const noSpeech = grokWebFallback(
      (async () => new Response("{}", { status: 422 })) as typeof fetch,
      env,
    );
    expect(await noSpeech(Buffer.from("a"), {})).toBe("");
    const broken = grokWebFallback(
      (async () => new Response("{}", { status: 502 })) as typeof fetch,
      env,
    );
    await expect(broken(Buffer.from("a"), {})).rejects.toThrow("HTTP 502");
  });
});

describe("isSilentRecording", () => {
  it("answers false for data ffmpeg cannot read", async () => {
    expect(await isSilentRecording(Buffer.from("kein audio"))).toBe(false);
  });
});
