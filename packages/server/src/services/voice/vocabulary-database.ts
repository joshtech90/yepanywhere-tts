import { setImmediate as yieldToLoop } from "node:timers/promises";
import type { VocabularyCaseForms } from "@yep-anywhere/shared";
import {
  loadSqliteDriver,
  type SqliteDatabase,
  type SqliteDriver,
} from "../../storage/sqlite.js";
import { SPEECH_VOCABULARY_TABLE_SCHEMA } from "./vocabulary-schema.js";

export interface VocabularyWordRow {
  word: string;
  user: number;
  assistant: number;
}

export interface VocabularyCheckpointRow {
  key: string;
  version: string;
  cutoff: number;
}

export interface VocabularyCommit {
  /** Words whose counts changed, with their current totals. */
  words: readonly VocabularyWordRow[];
  /** Words whose observed spellings changed, with their current evidence. */
  forms: ReadonlyMap<string, VocabularyCaseForms>;
  checkpoints: readonly VocabularyCheckpointRow[];
}

/**
 * Rows per transaction. Small enough that one commit cannot hold the event loop
 * for long, large enough that a scan's worth of new words is a handful of them.
 */
const COMMIT_CHUNK = 500;

/** What the store needs of its table, so a test can record what is written. */
export interface VocabularyTable {
  words(): VocabularyWordRow[];
  forms(): Map<string, VocabularyCaseForms>;
  checkpoints(): VocabularyCheckpointRow[];
  commit(batch: VocabularyCommit): Promise<void>;
  clear(): void;
  close(): void;
}

/**
 * The learned vocabulary table. Counts are keyed rows that are updated where
 * they changed, so the cost of recording a scan is proportional to the words it
 * touched rather than to everything ever learned. Iteration preserves the word
 * strings, which the top-N ranking needs and a membership filter could not give
 * back.
 *
 * The file belongs on local disk: it is written as agent sessions produce text,
 * and it is regenerable by rescanning the same history.
 */
export class VocabularyDatabase implements VocabularyTable {
  private constructor(private readonly database: SqliteDatabase) {}

  static open(
    path: string,
    driver: SqliteDriver | undefined = loadSqliteDriver(),
  ): VocabularyDatabase | undefined {
    if (!driver) return undefined;
    const database = driver.open(path);
    try {
      database.exec("PRAGMA busy_timeout = 250");
      // Counts are relearnable, so no fsync is worth putting on a scan's write
      // path. Write-ahead logging with synchronous off keeps commits off the
      // critical path entirely; a power loss or kernel crash can drop recent
      // counts, and an ordinary process crash cannot, which is the trade the
      // maintainer asked for. The journal mode stays write-ahead rather than
      // memory or off, because those risk a corrupt file rather than lost
      // counts, and this database also carries per-session scan checkpoints.
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = OFF");
      database.exec(SPEECH_VOCABULARY_TABLE_SCHEMA);
      return new VocabularyDatabase(database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  words(): VocabularyWordRow[] {
    const statement = this.database.prepare(
      "SELECT word, user_count, assistant_count FROM speech_words",
    );
    try {
      return statement.all().map((row) => ({
        word: String(row.word),
        user: Number(row.user_count),
        assistant: Number(row.assistant_count),
      }));
    } finally {
      statement.finalize();
    }
  }

  forms(): Map<string, VocabularyCaseForms> {
    const statement = this.database.prepare(
      "SELECT word, surface, free_count, forced_count FROM speech_word_forms",
    );
    try {
      const forms = new Map<string, VocabularyCaseForms>();
      for (const row of statement.all()) {
        const word = String(row.word);
        const entry = forms.get(word) ?? {};
        entry[String(row.surface)] = [
          Number(row.free_count),
          Number(row.forced_count),
        ];
        forms.set(word, entry);
      }
      return forms;
    } finally {
      statement.finalize();
    }
  }

  checkpoints(): VocabularyCheckpointRow[] {
    const statement = this.database.prepare(
      "SELECT session_key, source_version, cutoff FROM speech_sessions",
    );
    try {
      return statement.all().map((row) => ({
        key: String(row.session_key),
        version: String(row.source_version),
        cutoff: Number(row.cutoff),
      }));
    } finally {
      statement.finalize();
    }
  }

  /**
   * Apply one scan's changes in bounded transactions, yielding between them so
   * a large batch cannot stall the server that is producing the text.
   */
  async commit(batch: VocabularyCommit): Promise<void> {
    const words = this.database.prepare(
      `INSERT INTO speech_words (word, user_count, assistant_count)
       VALUES (?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET
         user_count = excluded.user_count,
         assistant_count = excluded.assistant_count`,
    );
    const dropForms = this.database.prepare(
      "DELETE FROM speech_word_forms WHERE word = ?",
    );
    const addForm = this.database.prepare(
      `INSERT INTO speech_word_forms (word, surface, free_count, forced_count)
       VALUES (?, ?, ?, ?)`,
    );
    const sessions = this.database.prepare(
      `INSERT INTO speech_sessions (session_key, source_version, cutoff)
       VALUES (?, ?, ?)
       ON CONFLICT(session_key) DO UPDATE SET
         source_version = excluded.source_version,
         cutoff = excluded.cutoff`,
    );
    try {
      for (const chunk of chunks(batch.words, COMMIT_CHUNK)) {
        this.database.transaction(() => {
          for (const row of chunk) words.run(row.word, row.user, row.assistant);
        });
        await yieldToLoop();
      }
      for (const chunk of chunks([...batch.forms], COMMIT_CHUNK)) {
        this.database.transaction(() => {
          for (const [word, entry] of chunk) {
            dropForms.run(word);
            for (const [surface, [free, forced]] of Object.entries(entry))
              addForm.run(word, surface, free, forced);
          }
        });
        await yieldToLoop();
      }
      for (const chunk of chunks(batch.checkpoints, COMMIT_CHUNK)) {
        this.database.transaction(() => {
          for (const row of chunk)
            sessions.run(row.key, row.version, row.cutoff);
        });
        await yieldToLoop();
      }
    } finally {
      words.finalize();
      dropForms.finalize();
      addForm.finalize();
      sessions.finalize();
    }
  }

  clear(): void {
    this.database.transaction(() => {
      this.database.exec(
        "DELETE FROM speech_words; DELETE FROM speech_word_forms; DELETE FROM speech_sessions",
      );
    });
  }

  close(): void {
    this.database.close();
  }
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size)
    yield items.slice(index, index + size);
}
