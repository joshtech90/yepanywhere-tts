import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { appendSimulatedTranscriptTurn } from "./simulated-transcript.mjs";

test("simulated turns are readable with the same ordered identities after persistence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ya-sim-transcript-"));
  try {
    for (let turn = 0; turn < 2; turn += 1) {
      await appendSimulatedTranscriptTurn({
        directory,
        sessionId: "perf-sim-test",
        cwd: "/fixture/project",
        userMessage: { uuid: `user-${turn}`, text: `prompt ${turn}` },
        assistant: {
          type: "assistant",
          uuid: `assistant-${turn}`,
          message: {
            role: "assistant",
            content: [{ type: "text", text: `reply ${turn}` }],
          },
        },
        parentUuid: turn === 0 ? null : "assistant-0",
      });
    }
    const rows = (
      await readFile(path.join(directory, "perf-sim-test.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      rows.map((row) => row.uuid),
      ["user-0", "assistant-0", "user-1", "assistant-1"],
    );
    assert.deepEqual(
      rows.map((row) => row.parentUuid),
      [null, "user-0", "assistant-0", "user-1"],
    );
    assert.equal(rows[2].message.content, "prompt 1");
    assert.equal(rows[3].message.content[0].text, "reply 1");
    assert.ok(
      rows.every(
        (row) =>
          row.sessionId === "perf-sim-test" && row.cwd === "/fixture/project",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
