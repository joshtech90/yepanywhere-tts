import type { Stats } from "node:fs";
import type { ClaudeSessionEntry, UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  addEntryToState,
  buildSummaryFromState,
  createParseState,
} from "../../src/sessions/claude-summary.js";

const FILE_TIME = new Date("2026-09-01T00:00:00.000Z");

const stats = {
  birthtime: FILE_TIME,
  birthtimeMs: FILE_TIME.getTime(),
  mtime: FILE_TIME,
  size: 1,
} as Stats;

function summaryOf(entries: readonly Record<string, unknown>[]) {
  const state = createParseState();
  entries.forEach((entry, index) => {
    addEntryToState(state, entry as unknown as ClaudeSessionEntry, index);
  });
  return buildSummaryFromState(state, {
    filePath: "/tmp/session.jsonl",
    stats,
    sessionId: "session",
    projectId: "project" as UrlProjectId,
  });
}

function userText(uuid: string, parentUuid: string | null, at: string) {
  return {
    type: "user",
    uuid,
    parentUuid,
    timestamp: at,
    message: { content: "please look at the relay" },
  };
}

function assistantText(uuid: string, parentUuid: string, at: string) {
  return {
    type: "assistant",
    uuid,
    parentUuid,
    timestamp: at,
    message: {
      content: [{ type: "text", text: "on it" }],
      model: "claude-fable-5",
    },
  };
}

/** A tool result arrives as a user entry, carrying blocks rather than prose. */
function toolResult(uuid: string, parentUuid: string, at: string) {
  return {
    type: "user",
    uuid,
    parentUuid,
    timestamp: at,
    message: {
      content: [
        { type: "tool_result", tool_use_id: "tool-1", content: "done" },
      ],
    },
  };
}

describe("claude summary last human turn", () => {
  it("reports when someone last wrote, not when the agent last worked", () => {
    const summary = summaryOf([
      userText("u1", null, "2026-09-01T10:00:00.000Z"),
      assistantText("a1", "u1", "2026-09-01T10:00:05.000Z"),
      userText("u2", "a1", "2026-09-01T12:00:00.000Z"),
      assistantText("a2", "u2", "2026-09-01T12:00:30.000Z"),
    ]);
    expect(summary?.lastHumanTurnAt).toBe("2026-09-01T12:00:00.000Z");
    expect(summary?.updatedAt).toBe("2026-09-01T12:00:30.000Z");
  });

  it("does not advance for the agent's own tool results", () => {
    const summary = summaryOf([
      userText("u1", null, "2026-09-01T10:00:00.000Z"),
      assistantText("a1", "u1", "2026-09-01T10:00:05.000Z"),
      toolResult("t1", "a1", "2026-09-01T18:00:00.000Z"),
      assistantText("a2", "t1", "2026-09-01T18:00:02.000Z"),
    ]);
    expect(summary?.lastHumanTurnAt).toBe("2026-09-01T10:00:00.000Z");
    expect(summary?.updatedAt).toBe("2026-09-01T18:00:02.000Z");
  });
});
