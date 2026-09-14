import { mkdtempSync, rmSync } from "node:fs";
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

const MESSAGES = 60;

/**
 * One session of distinct messages, and a filter far too small to hold them:
 * 64 bytes is a single block, whose design load is a few dozen keys.
 */
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-vocabulary-relearn-"));
  const timestamp = new Date().toISOString();
  const messages: Message[] = Array.from({ length: MESSAGES }, (_, index) => ({
    uuid: `m${index}`,
    type: "user" as const,
    timestamp,
    content: `distinctword${index}`,
  }));
  const store = new VocabularyStore(dataDir, {
    seenBytes: 64,
  });
  const learning = new VocabularyLearning(store, async function* () {
    yield {
      key: "durable-session",
      version: "v1",
      updatedAt: Date.parse(timestamp),
      messages: async function* () {
        yield messages;
      },
    };
  });
  cleanup.push(async () => {
    await learning.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { learning, store };
}

it("relearns a full fingerprint filter once, then backs off instead of looping", async () => {
  const warn = vi.spyOn(getLogger(), "warn").mockImplementation(() => {});
  const { learning, store } = fixture();
  learning.configure({ enabled: true, biasing: false, hours: 24 });
  await learning.settled();
  await store.settled();

  const full = warn.mock.calls.filter(([, message]) =>
    String(message).includes("fingerprint filter is full"),
  );
  expect(full).toHaveLength(1);
  // The window cannot fit this filter, so it is full again after the relearn.
  // Backing off is the contract: recognition keeps a filter that dedupes
  // approximately rather than a server that rescans forever.
  expect(store.seenSaturated).toBe(true);
  // Everything the relearn re-read is counted once. A few messages fall to the
  // overloaded filter's false positives and are skipped.
  const totals = learning.status().totals;
  expect(totals.words).toBeGreaterThan(MESSAGES * 0.8);
  expect(totals.words).toBeLessThanOrEqual(MESSAGES);
  expect(totals.user).toBe(totals.words);
});
