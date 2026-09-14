import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { getLogger } from "../../src/logging/logger.js";
import { VocabularyLearning } from "../../src/services/voice/VocabularyLearning.js";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";
import type { Message } from "../../src/supervisor/types.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});

const HOUR = 3600_000;

/**
 * Most messages are older than the one-hour window and ten are inside it,
 * against a 64-byte filter whose single block reaches a tenth of a percent at
 * roughly 35 keys. So one scan overloads it, and the compaction that follows
 * has both a small window to rebuild from and older content to forget.
 */
function fixture(count: number) {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-vocabulary-compaction-"));
  const now = Date.now();
  const messages: Message[] = Array.from({ length: count }, (_, index) => ({
    uuid: `m${index}`,
    type: "user" as const,
    timestamp: new Date(
      index < count - 10 ? now - 6 * HOUR : now - HOUR / 4,
    ).toISOString(),
    content: `distinctword${index}`,
  }));
  const store = new VocabularyStore(dataDir, { seenBytes: 64 });
  const learning = new VocabularyLearning(
    store,
    async function* () {
      yield {
        key: "durable-session",
        version: "v1",
        updatedAt: now,
        messages: async function* () {
          yield messages;
        },
      };
    },
    { env: { YEP_SPEECH_VOCABULARY_EPSILON_HOURS: "1" } },
  );
  cleanup.push(async () => {
    await learning.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { learning, store, dataDir, now };
}

it("compacts an overloaded filter to its window, keeping every learned count", async () => {
  const info = vi.spyOn(getLogger(), "info").mockImplementation(() => {});
  vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
  const { learning, store, dataDir } = fixture(80);

  learning.configure({ enabled: true, biasing: false, hours: 24 });
  await learning.settled();
  await store.settled();

  const compacted = info.mock.calls.filter(([, message]) =>
    String(message).includes("Compacted the speech vocabulary"),
  );
  expect(compacted).toHaveLength(1);

  // The counts are the point: compaction rebuilds the filter and touches
  // nothing that was learned through it.
  const totals = learning.status().totals;
  expect(totals.words).toBeGreaterThan(0);
  expect(totals.user).toBe(totals.words);

  // The floor now stands where the rebuild started, and the filter holds only
  // the window, so it is far below the load that triggered this.
  expect(store.seenFrom).toBeGreaterThan(0);
  expect(store.seenOverloaded).toBe(false);
  expect(statSync(join(dataDir, "speech-seen.bloom")).size).toBeGreaterThan(0);
  expect(() =>
    statSync(join(dataDir, "speech-seen.bloom.rebuilding")),
  ).toThrow();
});

it("refuses to count content below the floor a second time", async () => {
  vi.spyOn(getLogger(), "info").mockImplementation(() => {});
  vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
  const { learning, store, now } = fixture(80);

  learning.configure({ enabled: true, biasing: false, hours: 24 });
  await learning.settled();
  await store.settled();
  const before = learning.status().totals.words;

  // A message the compaction deliberately forgot. Without the floor the filter
  // would report it as new, which is exactly the double count compaction would
  // otherwise introduce.
  const generation = store.settings().generation;
  expect(
    store.observe(
      "durable-session",
      { source: "user", timestamp: now - 6 * HOUR, text: "distinctword0" },
      generation,
    ),
  ).toBe(0);
  expect(learning.status().totals.words).toBe(before);

  // Content inside the window is still deduplicated by the rebuilt filter.
  expect(
    store.observe(
      "durable-session",
      { source: "user", timestamp: now - HOUR / 4, text: "distinctword79" },
      generation,
    ),
  ).toBe(0);
});

it("clears the floor and the filter's disk reservation when learning is stopped", async () => {
  vi.spyOn(getLogger(), "info").mockImplementation(() => {});
  vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
  const { learning, store, dataDir, now } = fixture(80);

  learning.configure({ enabled: true, biasing: false, hours: 24 });
  await learning.settled();
  await store.settled();
  expect(store.seenFrom).toBeGreaterThan(0);
  expect(statSync(join(dataDir, "speech-seen.bloom")).size).toBeGreaterThan(0);

  await learning.reset();

  // The floor is learned state, so stopping clears it with the counts. A
  // surviving floor would tell the next scan that everything older than the
  // last compaction was already counted, and a cleared store would refuse to
  // learn it.
  expect(store.seenFrom).toBe(0);
  expect(learning.status().totals.words).toBe(0);
  expect(() => statSync(join(dataDir, "speech-seen.bloom"))).toThrow();
  expect(
    store.observe(
      "durable-session",
      { source: "user", timestamp: now - 6 * HOUR, text: "distinctword0" },
      store.settings().generation,
    ),
  ).toBeGreaterThan(0);
});
