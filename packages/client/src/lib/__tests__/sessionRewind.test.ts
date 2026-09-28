import { describe, expect, it, vi } from "vitest";
import type { Message } from "../../types";
import {
  getSessionTurnIndex,
  providerSupportsSessionRewind,
  rewindThenDraftPrompt,
} from "../sessionRewind";

function userTurn(uuid: string, extra: Record<string, unknown> = {}): Message {
  return {
    type: "user",
    uuid,
    message: { role: "user", content: `prompt ${uuid}` },
    ...extra,
  } as unknown as Message;
}

function assistantTurn(uuid: string): Message {
  return {
    type: "assistant",
    uuid,
    message: { role: "assistant", content: "reply" },
  } as unknown as Message;
}

describe("getSessionTurnIndex", () => {
  it("numbers live user turns and skips rewound, subagent, and synthetic rows", () => {
    const index = getSessionTurnIndex([
      userTurn("u1"),
      assistantTurn("a1"),
      userTurn("u2"),
      assistantTurn("a2"),
      userTurn("dropped", { rewoundGroupId: "rw-1" }),
      userTurn("sub", { isSubagent: true }),
      userTurn("syn", { isSynthetic: true }),
      userTurn("u3"),
    ]);
    // Full-sequence numbering: the cleared turn keeps its ordinal and is
    // marked cleared; subagent and synthetic rows are not turns.
    expect([...index.idByIndex.entries()]).toEqual([
      [1, "u1"],
      [2, "u2"],
      [3, "dropped"],
      [4, "u3"],
    ]);
    expect(index.indexById.get("u3")).toBe(4);
    expect(index.clearedIds.has("dropped")).toBe(true);
    expect(index.lastIndex).toBe(4);
    expect(index.lastLiveIndex).toBe(4);
  });

  it("reports the last live turn when the tail was dropped", () => {
    // What a session looks like between a rewind and the next send: the
    // dropped turns sit at the cut and keep the higher ordinals, so "here"
    // is turn 2, not turn 4.
    const index = getSessionTurnIndex([
      userTurn("u1"),
      assistantTurn("a1"),
      userTurn("u2"),
      assistantTurn("a2"),
      userTurn("dropped-3", { rewoundGroupId: "rw-1" }),
      userTurn("dropped-4", { rewoundGroupId: "rw-1" }),
    ]);

    expect(index.lastIndex).toBe(4);
    expect(index.lastLiveIndex).toBe(2);
  });

  it("never numbers a persisted row the server left unstamped", () => {
    // A compacted Claude session: the compact summary and a skill body are
    // user-role rows normalization deliberately left without `turnIndex`.
    // Counting them would give the summary the next turn's N.
    const index = getSessionTurnIndex([
      userTurn("u1", { _source: "jsonl", turnIndex: 1 }),
      assistantTurn("a1"),
      userTurn("summary", {
        _source: "jsonl",
        message: {
          role: "user",
          content:
            "This session is being continued from a previous conversation that ran out of context.",
        },
      }),
      userTurn("u2", { _source: "jsonl", turnIndex: 2 }),
      assistantTurn("a2"),
      userTurn("skill", {
        _source: "jsonl",
        isMeta: true,
        message: {
          role: "user",
          content: "Base directory for this skill: /skills/review\n\nBody",
        },
      }),
    ]);

    expect([...index.idByIndex.entries()]).toEqual([
      [1, "u1"],
      [2, "u2"],
    ]);
    expect(index.indexById.has("summary")).toBe(false);
    expect(index.lastIndex).toBe(2);
    expect(index.lastLiveIndex).toBe(2);
  });

  it("numbers live stream rows after the last stamped turn with the server's predicate", () => {
    const index = getSessionTurnIndex([
      userTurn("u1", { _source: "jsonl", turnIndex: 1 }),
      assistantTurn("a1"),
      userTurn("live", { _source: "sdk" }),
      userTurn("live-summary", {
        _source: "sdk",
        isCompactSummary: true,
      }),
    ]);

    expect([...index.idByIndex.entries()]).toEqual([
      [1, "u1"],
      [2, "live"],
    ]);
  });

  it("reports no live turn when every turn was dropped", () => {
    const index = getSessionTurnIndex([
      userTurn("dropped-1", { rewoundGroupId: "rw-1" }),
      assistantTurn("a1"),
    ]);

    expect(index.lastIndex).toBe(1);
    expect(index.lastLiveIndex).toBe(0);
  });
});

function draftControls(initial: string) {
  const state = { draft: initial, flushed: 0, writes: 0 };
  return {
    state,
    controls: {
      getDraft: () => state.draft,
      setDraft: (value: string) => {
        state.draft = value;
        state.writes += 1;
      },
      flushDraft: () => {
        state.flushed += 1;
      },
    },
  };
}

describe("rewindThenDraftPrompt", () => {
  it("puts the prompt into an empty composer once the rewind succeeds", async () => {
    const { state, controls } = draftControls("");
    const rewind = vi.fn(async () => {
      expect(state.writes).toBe(0);
      return true;
    });

    await expect(
      rewindThenDraftPrompt(rewind, "retry this", () => controls),
    ).resolves.toBe(true);

    expect(state.draft).toBe("retry this");
    expect(state.flushed).toBe(1);
  });

  it("keeps a typed draft and adds the prompt after it", async () => {
    const { state, controls } = draftControls("half-typed thought");

    await rewindThenDraftPrompt(
      async () => true,
      "retry this",
      () => controls,
    );

    expect(state.draft).toBe("half-typed thought\n\nretry this");
  });

  it("leaves the draft untouched when the rewind fails", async () => {
    const { state, controls } = draftControls("half-typed thought");

    await expect(
      rewindThenDraftPrompt(
        async () => false,
        "retry this",
        () => controls,
      ),
    ).resolves.toBe(false);

    expect(state.draft).toBe("half-typed thought");
    expect(state.writes).toBe(0);
    expect(state.flushed).toBe(0);
  });
});

describe("providerSupportsSessionRewind", () => {
  it("accepts only Claude-family providers", () => {
    expect(providerSupportsSessionRewind("claude")).toBe(true);
    expect(providerSupportsSessionRewind("claude-gateway")).toBe(true);
    expect(providerSupportsSessionRewind("codex")).toBe(false);
    expect(providerSupportsSessionRewind(undefined)).toBe(false);
  });
});
