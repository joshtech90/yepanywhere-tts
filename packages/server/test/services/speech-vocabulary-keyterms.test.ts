import { mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { speechVocabularyTokens } from "@yep-anywhere/shared";
import { afterEach, expect, it, vi } from "vitest";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";
import { VocabularyKeyterms } from "../../src/services/voice/VocabularyKeyterms.js";
import { SpeechBackendRegistry } from "../../src/services/voice/registry.js";
import { createSpeechWebSocketSession } from "../../src/routes/speech.js";
import { getLogger } from "../../src/logging/logger.js";
import type { StreamingSpeechBackend } from "../../src/services/voice/SpeechBackend.js";

const cleanup: (() => Promise<void>)[] = [];
const baselineText = `${Array.from({ length: 1000 }, (_, i) => `common${i} 1000`).join("\n")}\nthe 100000\ncompiler 1\n`;
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ya-vocabulary-reference-"));
  const store = new VocabularyStore(dir);
  store.addWordCounts("compiler", 6, 4);
  store.addWordCounts("the", 100, 100);
  const vocabulary = new VocabularyKeyterms(store, dir);
  cleanup.push(async () => {
    await vocabulary.close();
    await store.close();
    rmSync(dir, { recursive: true });
  });
  const enable = () =>
    store.configure({ enabled: false, biasing: true, hours: 24 });
  return { dir, store, vocabulary, enable };
}

it("considers the full corpus, admits singletons and short terms, and fills only 100 slots", () => {
  const dir = mkdtempSync(join(tmpdir(), "ya-vocabulary-top-"));
  const store = new VocabularyStore(dir);
  cleanup.push(async () => rmSync(dir, { recursive: true }));
  store.configure({ enabled: false, biasing: true, hours: 24 });
  const baseline = new Map<string, number>();
  for (let i = 0; i < 2500; i++) {
    const word = `ordinary${i}`;
    store.addWordCounts(word, 100, 0);
    baseline.set(word, 1 / 2500);
  }
  store.addWordCounts("x", 0, 1);
  store.setReference(baseline);
  expect(store.keyterms(baseline)).toEqual(["x"]);
  for (let i = 0; i < 150; i++)
    store.addWordCounts(`term${i.toString().padStart(3, "0")}`, 1, 0);
  store.addWordCounts("z".repeat(51), 1000, 0);
  store.setReference(baseline);
  const selected = store.keyterms(baseline, 100, 50, new Set(["x"]));
  expect(selected).toHaveLength(100);
  expect(selected[0]).toBe("x");
  expect(selected).not.toContain("z".repeat(51));
});

it("sends learned spelling, drops contractions, and rations capitalized common words", () => {
  const dir = mkdtempSync(join(tmpdir(), "ya-vocabulary-case-"));
  const store = new VocabularyStore(dir);
  cleanup.push(async () => rmSync(dir, { recursive: true }));
  store.configure({ enabled: true, biasing: true, hours: 24 });
  const text = [
    "We use TypeScript here, and TypeScript stays.",
    "Sometimes i'll type it lazily and I'll fix that later.",
    "The YA server, YA client, YA relay, YA queue and YA scan share it.",
    "Detached HEAD, another HEAD, one more HEAD.",
    "Fine, OK, and OK again.",
  ].join("\n");
  const listed = new Set(speechVocabularyTokens(text));
  listed.delete("typescript");
  listed.delete("i'll");
  const baseline = new Map<string, number>(
    [...listed].map((word) => [word, 0.01]),
  );
  // The reference splits contractions into a stem and a clitic row.
  baseline.set("i", 0.09);
  baseline.set("'ll", 0.01);
  baseline.set("rarest", 0.0000001);
  store.setReference(baseline);
  // Enough counted text that a common word's expected count is meaningful.
  store.addWordCounts("filler", 100_000, 0);
  store.observe("session", { source: "user", timestamp: 1, text }, 0);

  const selected = store.keyterms(baseline, 10);
  expect(selected).toContain("TypeScript");
  expect(selected).not.toContain("typescript");
  expect(selected.filter((term) => term.toLowerCase() === "i'll")).toEqual([]);
  // Two of the three capitalized common words fit the 20% ration of ten slots.
  expect(selected).toContain("YA");
  expect(selected).toContain("HEAD");
  expect(selected).not.toContain("OK");
  expect(selected).not.toContain("ya");
});

it("does no disabled work, coalesces first use, reuses disk after reboot, and retains its map", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const f = fixture();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(baselineText));
  expect(await f.vocabulary.get()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  f.enable();
  expect(await Promise.all([f.vocabulary.get(), f.vocabulary.get()])).toEqual([
    ["compiler"],
    ["compiler"],
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  await f.vocabulary.close();
  const reopened = new VocabularyKeyterms(f.store, f.dir);
  try {
    expect(await reopened.get()).toEqual(["compiler"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const cache = readdirSync(f.dir).find((name) =>
      name.startsWith("speech-english-"),
    )!;
    unlinkSync(join(f.dir, cache));
    expect(await reopened.get()).toEqual(["compiler"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // The parsed list is kept for the process lifetime, so neither a long idle
    // period nor losing the downloaded file costs a dictation request a reparse
    // or a second download.
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    expect(await reopened.get()).toEqual(["compiler"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await reopened.get(["compiler"])).toEqual(["compiler"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await f.store.reset();
    expect(await reopened.get()).toEqual([]);
  } finally {
    await reopened.close();
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("omits learned terms on download failure, throttles retries, and retains explicit terms", async () => {
  // The simulated HTTP failure must emit this actionable diagnostic once.
  const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = fixture();
  f.enable();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("offline", { status: 503 }));
  const registry = new SpeechBackendRegistry();
  registry.setVocabularySource(() => f.vocabulary.get());
  expect(await registry.keyterms("ya-grok", ["explicit"])).toEqual([
    "explicit",
  ]);
  expect(await registry.keyterms("ya-grok")).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 60_001);
  fetch.mockResolvedValueOnce(new Response(baselineText));
  expect(await registry.keyterms("ya-grok")).toEqual(["compiler"]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ component: "speech", err: expect.any(Error) }),
    "English vocabulary reference unavailable; omitting learned keyterms for one minute",
  );
});

it("does not cache a disabled selection when reference loading completes", async () => {
  const f = fixture();
  f.enable();
  let finish!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.vocabulary.get();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  f.store.configure({ enabled: false, biasing: false, hours: 24 });
  finish(new Response(baselineText));
  expect(await pending).toEqual([]);
  f.enable();
  expect(await f.vocabulary.get()).toEqual(["compiler"]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not open a stream after disconnect during reference loading", async () => {
  const f = fixture();
  f.enable();
  let finish!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const stream = vi.fn<StreamingSpeechBackend["stream"]>();
  const registry = new SpeechBackendRegistry();
  registry.register({
    id: "ya-grok",
    label: "fixture",
    capabilities: { streaming: true },
    validate: async () => ({ ok: true }),
    transcribe: async () => "",
    stream,
  } as StreamingSpeechBackend);
  await registry.waitForValidation();
  registry.setVocabularySource(() => f.vocabulary.get());
  const session = createSpeechWebSocketSession(
    { speechBackendRegistry: registry },
    () => {},
  );
  session.handleMessage(
    JSON.stringify({
      type: "start",
      backendId: "ya-grok",
      streaming: true,
      encoding: "pcm",
    }),
  );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  session.close();
  finish(new Response(baselineText));
  await f.vocabulary.get();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(stream).not.toHaveBeenCalled();
});
