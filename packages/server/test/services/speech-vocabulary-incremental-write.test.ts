import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VocabularyCaseForms } from "@yep-anywhere/shared";
import { afterEach, expect, it } from "vitest";
import type {
  VocabularyCheckpointRow,
  VocabularyCommit,
  VocabularyTable,
  VocabularyWordRow,
} from "../../src/services/voice/vocabulary-database.js";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

/** Records every batch handed to the table, so a test can size the writes. */
class RecordingTable implements VocabularyTable {
  readonly batches: VocabularyCommit[] = [];
  words(): VocabularyWordRow[] {
    return [];
  }
  forms(): Map<string, VocabularyCaseForms> {
    return new Map();
  }
  checkpoints(): VocabularyCheckpointRow[] {
    return [];
  }
  async commit(batch: VocabularyCommit): Promise<void> {
    this.batches.push({
      words: [...batch.words],
      forms: new Map(batch.forms),
      checkpoints: [...batch.checkpoints],
    });
  }
  clear(): void {}
  close(): void {}
}

const VOCABULARY = 5000;

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-vocabulary-incremental-"));
  const table = new RecordingTable();
  const store = new VocabularyStore(dataDir, {
    seenBytes: 1 << 20,
    writeIntervalMs: 0,
    openTable: () => table,
  });
  cleanup.push(async () => {
    await store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { store, table };
}

it("writes only the words a scan changed, never the whole vocabulary", async () => {
  const { store, table } = fixture();
  store.configure({ enabled: true, biasing: false, hours: 24 });
  await store.load();
  for (let index = 0; index < VOCABULARY; index++)
    store.addWordCounts(`established${index}`, 3, 1);
  await store.flush();
  await store.settled();
  const seeded = table.batches.at(-1);
  expect(seeded?.words).toHaveLength(VOCABULARY);

  // One new message, two new words. Everything else is untouched and must not
  // be rewritten: the cost of recording a scan follows what the scan saw.
  store.observe(
    "session",
    {
      source: "user",
      timestamp: Date.now(),
      text: "blockedbloom scratchspace",
    },
    store.settings().generation,
  );
  store.checkpoint("session", "v1", 0);
  await store.flush();
  await store.settled();

  const incremental = table.batches.at(-1);
  expect(incremental?.words.map((row) => row.word).sort()).toEqual([
    "blockedbloom",
    "scratchspace",
  ]);
  expect(incremental?.checkpoints).toHaveLength(1);
  expect(store.totals().words).toBe(VOCABULARY + 2);

  // A repeat message adds nothing, so there is no batch at all.
  const batches = table.batches.length;
  store.observe(
    "session",
    {
      source: "user",
      timestamp: 1,
      text: "blockedbloom scratchspace",
    },
    store.settings().generation,
  );
  await store.flush();
  await store.settled();
  expect(table.batches).toHaveLength(batches + 1);
  expect(table.batches.at(-1)?.words.map((row) => row.word)).toEqual([
    "blockedbloom",
    "scratchspace",
  ]);
});
