import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { describe, expect, it } from "vitest";
import {
  COCKPIT_FOREIGN_TOOL_MAX_AGE_MS,
  inspectCockpitLatestTurn,
  isCockpitSessionWorkingElsewhere,
} from "./activity";

const NOW = Date.parse("2026-09-25T09:41:30.000Z");

function at(offsetMs: number) {
  return [
    {
      type: "assistant",
      timestamp: new Date(NOW + offsetMs).toISOString(),
    },
  ] as unknown as RenderItem["sourceMessages"];
}

function prompt(id: string): RenderItem {
  return {
    type: "user_prompt",
    id,
    content: "Bitte",
    sourceMessages: at(-60_000),
  } as RenderItem;
}

function tool(
  id: string,
  status: "pending" | "complete" | "incomplete",
  offsetMs = -20_000,
): RenderItem {
  return {
    type: "tool_call",
    id,
    toolName: "Bash",
    toolInput: { command: "python3 -c 'import time; time.sleep(60)'" },
    toolResult:
      status === "complete"
        ? { content: "1", isError: false }
        : undefined,
    status,
    sourceMessages: at(offsetMs),
  } as RenderItem;
}

function text(id: string, isStreaming = false): RenderItem {
  return {
    type: "text",
    id,
    text: "OK",
    isStreaming,
    sourceMessages: at(-5_000),
  } as RenderItem;
}

describe("inspectCockpitLatestTurn", () => {
  it("treats a server-orphaned tool call of the latest turn as open", () => {
    const turn = inspectCockpitLatestTurn([
      prompt("p1"),
      tool("t1", "incomplete"),
    ]);

    expect(turn.settled).toBe(false);
    expect(turn.openToolCallAt).toBe(NOW - 20_000);
  });

  it("ignores unanswered tool calls of earlier turns", () => {
    const turn = inspectCockpitLatestTurn([
      prompt("p1"),
      tool("t1", "incomplete"),
      text("a1"),
      prompt("p2"),
      text("a2"),
    ]);

    expect(turn).toEqual({ openToolCallAt: null, settled: true });
  });

  it("counts a finished answer after a tool as settled", () => {
    const turn = inspectCockpitLatestTurn([
      prompt("p1"),
      tool("t1", "complete"),
      text("a1"),
    ]);

    expect(turn.settled).toBe(true);
    expect(turn.openToolCallAt).toBeNull();
  });

  it("keeps a streaming answer unsettled", () => {
    expect(
      inspectCockpitLatestTurn([prompt("p1"), text("a1", true)]).settled,
    ).toBe(false);
  });
});

describe("isCockpitSessionWorkingElsewhere", () => {
  const openTurn = { openToolCallAt: NOW - 20_000, settled: false };

  it("always reports external ownership as work", () => {
    expect(
      isCockpitSessionWorkingElsewhere({
        owner: "external",
        processState: "idle",
        latestTurn: { openToolCallAt: null, settled: true },
        now: NOW,
      }),
    ).toBe(true);
  });

  it("bridges the quiet decay while a recent tool call is still open", () => {
    expect(
      isCockpitSessionWorkingElsewhere({
        owner: "none",
        processState: "idle",
        latestTurn: openTurn,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("gives up on an open tool call once it is too old", () => {
    expect(
      isCockpitSessionWorkingElsewhere({
        owner: "none",
        processState: "idle",
        latestTurn: openTurn,
        now: NOW - 20_000 + COCKPIT_FOREIGN_TOOL_MAX_AGE_MS,
      }),
    ).toBe(false);
  });

  it("leaves own processes and settled turns to their own state", () => {
    expect(
      isCockpitSessionWorkingElsewhere({
        owner: "self",
        processState: "idle",
        latestTurn: openTurn,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isCockpitSessionWorkingElsewhere({
        owner: "none",
        processState: "idle",
        latestTurn: { ...openTurn, settled: true },
        now: NOW,
      }),
    ).toBe(false);
  });
});
