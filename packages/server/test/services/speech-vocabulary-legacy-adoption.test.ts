import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import type { VocabularyCaseForms } from "@yep-anywhere/shared";
import { afterEach, expect, it } from "vitest";
import { scratchSpaceDirectories } from "../../src/lib/scratchSpace.js";
import type {
  VocabularyCheckpointRow,
  VocabularyCommit,
  VocabularyTable,
  VocabularyWordRow,
} from "../../src/services/voice/vocabulary-database.js";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";

/** The previous layout's whole-file snapshots, adopted once on first start. */
const LEGACY_FILES = [
  "speech-words.json",
  "speech-word-case.json",
  "speech-seen.hash",
];

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

/** A table whose first `commit` calls reject, standing in for a full disk. */
class FailingTable implements VocabularyTable {
  readonly batches: VocabularyCommit[] = [];
  constructor(private failures = 0) {}
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
    if (this.failures > 0) {
      this.failures--;
      throw new Error("commit failed");
    }
    this.batches.push(batch);
  }
  clear(): void {}
  close(): void {}
}

/**
 * A data directory holding only the previous layout's files, so construction
 * takes the adoption path. The write interval is left at its default: adoption
 * writes immediately rather than waiting for it.
 */
function fixture(failures = 0) {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-vocabulary-legacy-"));
  writeFileSync(
    join(dataDir, "speech-words.json"),
    JSON.stringify({ blockedbloom: [3, 1] }),
  );
  writeFileSync(
    join(dataDir, "speech-word-case.json"),
    JSON.stringify({ ya: { YA: [2, 0] } }),
  );
  writeFileSync(join(dataDir, "speech-seen.hash"), "");
  const table = new FailingTable(failures);
  const store = new VocabularyStore(dataDir, {
    seenBytes: 1 << 20,
    openTable: () => table,
  });
  cleanup.push(async () => {
    await store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { store, table, dataDir };
}

it("moves a table out of the directory earlier versions reserved", () => {
  const root = mkdtempSync(join(tmpdir(), "ya-vocabulary-reserved-"));
  const dataDir = join(root, "data");
  const env = { YEP_SCRATCH_DIR: join(root, "scratch") };
  // Placed through the enumeration the store itself consults, so this pins
  // that it looks where scratch space is, not a path spelled twice.
  const reserved = scratchSpaceDirectories(
    "speech-vocabulary",
    dataDir,
    env,
  ).at(0) as string;
  mkdirSync(reserved, { recursive: true });
  writeFileSync(join(reserved, "speech-vocabulary.sqlite"), "table bytes");
  const store = new VocabularyStore(dataDir, {
    env,
    seenBytes: 1 << 20,
    openTable: () => new FailingTable(),
  });
  cleanup.push(async () => {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });

  expect(existsSync(join(reserved, "speech-vocabulary.sqlite"))).toBe(false);
  expect(readFileSync(join(dataDir, "speech-vocabulary.sqlite"), "utf8")).toBe(
    "table bytes",
  );
});

it("deletes the legacy files once the adopting write lands", async () => {
  const { store, table, dataDir } = fixture();
  await yieldToLoop();

  for (const name of LEGACY_FILES)
    expect(existsSync(join(dataDir, name))).toBe(false);
  expect(table.batches.at(0)?.words).toEqual([
    { word: "blockedbloom", user: 3, assistant: 1 },
  ]);
  expect(store.totals()).toMatchObject({ words: 1, user: 3, assistant: 1 });
});

it("keeps the legacy files when the adopting write fails", async () => {
  const { store, table, dataDir } = fixture(1);
  await yieldToLoop();

  // The counts exist only in memory until a write lands, so deleting the files
  // on writer quiescence rather than on success loses them to the next restart.
  expect(table.batches).toHaveLength(0);
  for (const name of LEGACY_FILES)
    expect(existsSync(join(dataDir, name))).toBe(true);

  // The rows stay dirty, so the next write carries the adopted counts after all.
  await store.settled();
  expect(table.batches.at(0)?.words).toEqual([
    { word: "blockedbloom", user: 3, assistant: 1 },
  ]);
  expect(store.totals()).toMatchObject({ words: 1, user: 3, assistant: 1 });
});
