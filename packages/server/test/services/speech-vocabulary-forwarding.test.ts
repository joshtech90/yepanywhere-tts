import { afterEach, expect, it, vi } from "vitest";
import {
  createSpeechRoutes,
  createSpeechWebSocketSession,
} from "../../src/routes/speech.js";
import { SpeechBackendRegistry } from "../../src/services/voice/registry.js";
import { XaiSttBackend } from "../../src/services/voice/xaiSttBackend.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";
import { VocabularyKeyterms } from "../../src/services/voice/VocabularyKeyterms.js";

const upstream = vi.hoisted(() => ({ urls: [] as URL[] }));
vi.mock("ws", () => ({
  default: class {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    private handlers = new Map<string, (data?: unknown) => void>();
    constructor(url: URL) {
      upstream.urls.push(url);
      queueMicrotask(() =>
        this.handlers.get("message")?.(
          JSON.stringify({ type: "transcript.created" }),
        ),
      );
    }
    on(name: string, handler: (data?: unknown) => void) {
      this.handlers.set(name, handler);
    }
    send(data: unknown) {
      if (typeof data === "string")
        this.handlers.get("message")?.(
          JSON.stringify({ type: "transcript.done", text: "parakeet" }),
        );
    }
    close() {
      this.readyState = 3;
      this.handlers.get("close")?.();
    }
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  upstream.urls.length = 0;
});

it("forwards the selected vocabulary through real HTTP and relayed stream entrypoints", async () => {
  const registry = new SpeechBackendRegistry();
  registry.register(new XaiSttBackend("test-key"));
  await registry.waitForValidation();
  const dataDir = mkdtempSync(join(tmpdir(), "ya-keyterms-"));
  const store = new VocabularyStore(dataDir);
  store.configure({ enabled: false, biasing: true, hours: 24 });
  store.addWordCounts("ordinary", 100, 0);
  store.addWordCounts("parakeet", 6, 14);
  store.addWordCounts("sqlite", 8, 0);
  store.addWordCounts("unknown", 100, 0);
  store.addWordCounts("typo", 1, 0);
  store.addWordCounts("assistantonly", 0, 100);
  store.addWordCounts("the", 1000, 1000);
  const vocabulary = new VocabularyKeyterms(store, dataDir);
  registry.setVocabularySource((context) =>
    vocabulary.get(context?.sessionTerms),
  );
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async (url) =>
        new Response(
          String(url).includes("FrequencyWords")
            ? `${Array.from({ length: 1000 }, (_, i) => `common${i} 1000`).join("\n")}\nthe 90000\nordinary 9000\nparakeet 1\nsqlite 4\nassistantonly 1\n`
            : JSON.stringify({ text: "parakeet" }),
        ),
    );
  try {
    const routes = createSpeechRoutes({
      speechBackendRegistry: registry,
      upgradeWebSocket: () => () => new Response(),
    });
    const response = await routes.request("/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backendId: "ya-grok", audioBase64: "YQ==" }),
    });
    expect(response.status).toBe(200);
    const form = fetch.mock.calls.find(
      (call) => call[1]?.body instanceof FormData,
    )?.[1]?.body as FormData;
    expect(form.getAll("keyterm")).toEqual([
      "unknown",
      "assistantonly",
      "parakeet",
      "sqlite",
      "typo",
    ]);
    const messages: unknown[] = [];
    const session = createSpeechWebSocketSession(
      { speechBackendRegistry: registry },
      (message) => messages.push(message),
    );
    try {
      session.handleMessage(
        JSON.stringify({
          type: "start",
          backendId: "ya-grok",
          streaming: true,
          sampleRate: 16000,
          encoding: "pcm",
          context: { sessionTerms: ["sqlite", "the"] },
        }),
      );
      await vi.waitFor(() => expect(upstream.urls).toHaveLength(1));
      expect(upstream.urls[0]?.searchParams.getAll("keyterm")).toEqual([
        "unknown",
        "assistantonly",
        "sqlite",
        "parakeet",
        "typo",
      ]);
      session.handleMessage(Buffer.from("pcm"));
      session.handleMessage(JSON.stringify({ type: "stop" }));
      await vi.waitFor(() =>
        expect(messages).toContainEqual(
          expect.objectContaining({ type: "final", text: "parakeet" }),
        ),
      );
    } finally {
      session.close();
    }
    const batchMessages: unknown[] = [];
    const batch = createSpeechWebSocketSession(
      { speechBackendRegistry: registry },
      (message) => batchMessages.push(message),
    );
    try {
      batch.handleMessage(
        JSON.stringify({
          type: "start",
          backendId: "ya-grok",
          context: { sessionTerms: ["sqlite"] },
        }),
      );
      batch.handleMessage(Buffer.from("audio"));
      batch.handleMessage(JSON.stringify({ type: "stop" }));
      await vi.waitFor(() =>
        expect(batchMessages).toContainEqual(
          expect.objectContaining({ type: "final", text: "parakeet" }),
        ),
      );
      const batchForm = fetch.mock.calls
        .filter((call) => call[1]?.body instanceof FormData)
        .at(-1)?.[1]?.body as FormData;
      expect(batchForm.getAll("keyterm")).toEqual([
        "unknown",
        "assistantonly",
        "sqlite",
        "parakeet",
        "typo",
      ]);
    } finally {
      batch.close();
    }
    store.configure({ enabled: false, biasing: false, hours: 24 });
    expect(await registry.keyterms("ya-grok")).toEqual([]);
    expect(await registry.keyterms("ya-whisper", ["existing"])).toEqual([
      "existing",
    ]);
  } finally {
    await vocabulary.close();
    await store.close();
    rmSync(dataDir, { recursive: true });
  }
});
