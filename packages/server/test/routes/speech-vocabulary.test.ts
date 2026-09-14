import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createSpeechVocabularyRoutes } from "../../src/routes/speech-vocabulary.js";
import { VocabularyStore } from "../../src/services/voice/VocabularyStore.js";
import { VocabularyLearning } from "../../src/services/voice/VocabularyLearning.js";
import type { VocabularyStoreOptions } from "../../src/services/voice/VocabularyStore.js";
import type { Message } from "../../src/supervisor/types.js";
import { SessionReader } from "../../src/sessions/reader.js";
import { normalizeSession } from "../../src/sessions/normalization.js";
import { encodeProjectId } from "../../src/projects/paths.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function fixture() {
  return fixtureWithOptions({});
}

function fixtureWithOptions(options: VocabularyStoreOptions = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "ya-speech-vocabulary-"));
  let learning: VocabularyLearning;
  let version = "v1";
  const userTime = new Date().toISOString();
  const assistantTime = new Date(Date.now() + 1000).toISOString();
  let messages: Message[] = [
    {
      uuid: "a",
      type: "user",
      timestamp: userTime,
      content: "Parakeet parakeet SQLite",
    },
    {
      uuid: "b",
      type: "assistant",
      timestamp: assistantTime,
      content: [
        { type: "text", text: "SQLite parakeet" },
        { type: "tool_use", input: "ignored" },
      ],
    },
  ];
  const open = () => {
    learning = new VocabularyLearning(
      new VocabularyStore(dataDir, options),
      async function* () {
        yield {
          key: "durable-session",
          version,
          updatedAt: Date.parse(userTime),
          messages: async function* () {
            yield messages;
          },
        };
      },
    );
  };
  open();
  cleanup.push(async () => {
    await learning.close();
    rmSync(dataDir, { recursive: true });
  });
  return {
    dataDir,
    get learning() {
      return learning;
    },
    get routes() {
      return createSpeechVocabularyRoutes(learning);
    },
    change(next: Message[]) {
      messages = next;
      version += "x";
    },
    async reopen() {
      await learning.close();
      open();
    },
    async enable() {
      const response = await this.routes.request("/vocabulary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, biasing: true, hours: 24 }),
      });
      expect(response.status).toBe(200);
      await learning.settled();
      expect(learning.status().scan.error).toBeUndefined();
    },
    userTime,
    assistantTime,
  };
}

/** Modification times of everything the learned table keeps on local disk. */
function tableWrites(root: string): Record<string, number> {
  const seen: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else seen[path] = statSync(path).mtimeMs;
    }
  };
  walk(root);
  return seen;
}

async function waitForIdle(learning: VocabularyLearning): Promise<void> {
  let loops = 200;
  while (loops--) {
    const state = learning.status().scan.state;
    if (state === "error") {
      throw new Error(learning.status().scan.error ?? "scan error");
    }
    if (state === "idle") return;
    await setTimeout(25);
  }
  throw new Error("scan did not return to idle");
}

describe("persistent speech learning through its routes", () => {
  it("respects the write-interval floor", async () => {
    const f = fixtureWithOptions({ writeIntervalMs: 2_000 });
    await f.enable();
    const before = tableWrites(f.dataDir);
    const now = new Date();
    f.change([
      {
        type: "user",
        timestamp: new Date(now.getTime() + 1).toISOString(),
        content: "compile compile compile",
      },
      {
        type: "assistant",
        timestamp: new Date(now.getTime() + 2).toISOString(),
        content: "compile compile",
      },
    ]);
    f.learning.scan();
    await setTimeout(50);
    expect(tableWrites(f.dataDir)).toEqual(before);
    await setTimeout(2_100);
    await f.learning.settled();
    await waitForIdle(f.learning);
    expect(tableWrites(f.dataDir)).not.toEqual(before);
  });

  it("reads the write interval from env", async () => {
    const f = fixtureWithOptions({
      env: { ...process.env, YEP_SPEECH_VOCABULARY_WRITE_SECONDS: "2" },
    });
    await f.enable();
    const before = tableWrites(f.dataDir);
    const now = new Date();
    f.change([
      {
        type: "user",
        timestamp: new Date(now.getTime() + 1).toISOString(),
        content: "compiler compiler compiler",
      },
      {
        type: "assistant",
        timestamp: new Date(now.getTime() + 2).toISOString(),
        content: "compiler",
      },
    ]);
    f.learning.scan();
    await setTimeout(500);
    expect(tableWrites(f.dataDir)).toEqual(before);
    await setTimeout(2_000);
    await f.learning.settled();
    await waitForIdle(f.learning);
    expect(tableWrites(f.dataDir)).not.toEqual(before);
  });

  it("writes nothing when a scan finds nothing new", async () => {
    const f = fixture();
    await f.enable();
    await f.learning.store.settled();
    const revision = f.learning.store.revision;
    const before = tableWrites(f.dataDir);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    // A live session republishes the catalog every few seconds, and each
    // publication starts a scan. One that observes nothing must not rewrite
    // the table, the fingerprint filter, or the ranking.
    for (let attempt = 0; attempt < 5; attempt++) {
      f.learning.scan(false);
      await f.learning.settled();
    }
    await f.learning.store.settled();
    expect(f.learning.store.revision).toBe(revision);
    expect(tableWrites(f.dataDir)).toEqual(before);
  });

  it("reenters the real durable Claude reader without changing contributions", async () => {
    const f = fixture();
    const sessionDir = mkdtempSync(join(tmpdir(), "ya-vocabulary-source-"));
    cleanup.push(async () => rmSync(sessionDir, { recursive: true }));
    const sessionId = "stable-durable-source";
    const timestamp = new Date().toISOString();
    writeFileSync(
      join(sessionDir, `${sessionId}.jsonl`),
      `${[
        {
          type: "user",
          uuid: "user-1",
          parentUuid: null,
          timestamp,
          message: { role: "user", content: "SQLite parakeet" },
        },
        {
          type: "assistant",
          uuid: "assistant-1",
          parentUuid: "user-1",
          timestamp,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Parakeet" }],
          },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`,
    );
    for (let pass = 0; pass < 2; pass++) {
      const reader = new SessionReader({ sessionDir });
      const loaded = await reader.getSession(
        sessionId,
        encodeProjectId(sessionDir),
      );
      expect(loaded).not.toBeNull();
      f.change(normalizeSession(loaded!).messages);
      await f.enable();
      f.learning.scan();
      await f.learning.settled();
      expect(f.learning.status().totals).toEqual({
        words: 2,
        user: 2,
        assistant: 1,
      });
      await reader.close();
      await f.reopen();
    }
  });
  it("survives reboot, missing scan progress, changed UI IDs, and reordered replay", async () => {
    const f = fixture();
    expect(f.learning.status().enabled).toBe(false);
    expect(
      (await f.routes.request("/vocabulary/scan", { method: "POST" })).status,
    ).toBe(409);
    await f.enable();
    expect(f.learning.status().totals).toEqual({
      words: 2,
      user: 3,
      assistant: 2,
    });
    await f.reopen();
    await f.routes.request("/vocabulary/scan", { method: "POST" });
    await f.learning.settled();
    expect(f.learning.status().totals).toEqual({
      words: 2,
      user: 3,
      assistant: 2,
    });
    f.change([
      {
        uuid: "different-b",
        type: "assistant",
        timestamp: f.assistantTime,
        content: "SQLite parakeet",
      },
      {
        uuid: "different-a",
        type: "user",
        timestamp: f.userTime,
        content: "Parakeet parakeet SQLite",
      },
    ]);
    f.learning.scan();
    await f.learning.settled();
    expect(f.learning.status().totals).toEqual({
      words: 2,
      user: 3,
      assistant: 2,
    });
    expect(
      (await (await f.routes.request("/vocabulary")).json()).words,
    ).toBeUndefined();
    expect(
      (await (await f.routes.request("/vocabulary?includeWords=1")).json())
        .words,
    ).toEqual([
      { word: "parakeet", user: 2, assistant: 1 },
      { word: "sqlite", user: 1, assistant: 1 },
    ]);
  });

  it("keeps reset history cleared across automatic catalog work and reboot", async () => {
    const f = fixture();
    await f.enable();
    await f.learning.reset();
    f.learning.scan(false);
    await f.learning.settled();
    expect(f.learning.status().totals.words).toBe(0);
    await f.reopen();
    f.learning.scan(false);
    await f.learning.settled();
    expect(f.learning.status().totals.words).toBe(0);
    f.learning.scan();
    await f.learning.settled();
    expect(f.learning.status().totals.words).toBe(2);
  });

  it("replaces revised content atomically, preserves disabled state, and relearns after reset", async () => {
    const f = fixture();
    await f.enable();
    f.change([
      { type: "user", timestamp: new Date().toISOString(), content: "NeMo" },
    ]);
    f.learning.scan();
    await waitForIdle(f.learning);
    await f.learning.settled();
    await f.learning.store.settled();
    const words = f.learning.status(true).words ?? [];
    expect(words.some((word) => word.word === "nemo")).toBe(true);
    await f.routes.request("/vocabulary", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, biasing: true, hours: 24 }),
    });
    await f.reopen();
    expect(f.learning.status().enabled).toBe(false);
    expect(
      (f.learning.status(true).words ?? []).some(
        (word) => word.word === "nemo",
      ),
    ).toBe(true);
    const generation = f.learning.status().generation;
    await f.routes.request("/vocabulary/reset", { method: "POST" });
    expect(f.learning.status().generation).toBe(generation + 1);
    expect(f.learning.status().totals.words).toBe(0);
    await f.enable();
    expect(
      (f.learning.status(true).words ?? []).some(
        (word) => word.word === "nemo",
      ),
    ).toBe(true);
  });

  it("rejects stale generation observes after reset", async () => {
    const f = fixture();
    await f.enable();
    const generation = f.learning.status().generation;
    await f.learning.reset();
    expect(
      f.learning.store.observe(
        "durable-session",
        { source: "user", timestamp: Date.now(), text: "newword" },
        generation,
      ),
    ).toBe(0);
    expect(f.learning.status().totals.words).toBe(0);
  });
});
