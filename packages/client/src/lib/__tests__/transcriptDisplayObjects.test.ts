import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { insertTranscriptDisplayObjects } from "../transcriptDisplayObjects";

function displayObject(
  id: string,
  placementAfterMessageId: string,
): TranscriptDisplayObject {
  return {
    id,
    kind: "fork-summary",
    createdAt: "2026-06-23T00:00:00.000Z",
    placementAfterMessageId,
    sourceMessageId: "user-1",
    retainedThroughMessageId: "assistant-1",
    status: "generating",
  };
}

describe("insertTranscriptDisplayObjects", () => {
  it("recovers old bang blocks by run time only in the live window", () => {
    const items: RenderItem[] = [
      {
        type: "text",
        sourceBlockIndex: 0,
        id: "answer",
        text: "done",
        sourceMessages: [
          {
            uuid: "answer",
            type: "assistant",
            timestamp: "2026-09-21T20:23:23Z",
          },
        ],
      },
      {
        type: "user_prompt",
        id: "later",
        content: "next",
        sourceMessages: [
          { uuid: "later", type: "user", timestamp: "2026-09-21T20:30:00Z" },
        ],
      },
    ];
    const run: TranscriptDisplayObject = {
      id: "run",
      kind: "bang-command",
      command: "fgerrit",
      cwd: "/project",
      status: "done",
      exitCode: 127,
      placementAfterMessageId: "msg-1790022203515",
      createdAt: "2026-09-21T20:25:26Z",
    };
    expect(
      insertTranscriptDisplayObjects(items, [run], true).map((item) => item.id),
    ).toEqual(["answer", "run", "later"]);
    expect(insertTranscriptDisplayObjects(items, [run])).toBe(items);
    expect(insertTranscriptDisplayObjects(items.slice(1), [run], true)).toEqual(
      items.slice(1),
    );
  });

  it("places objects after the last render item sourced from the anchor", () => {
    const anchor: Message = { id: "assistant-1", type: "assistant" };
    const items: RenderItem[] = [
      {
        type: "thinking",
        sourceBlockIndex: 0,
        id: "thinking-1",
        thinking: "working",
        status: "complete",
        sourceMessages: [anchor],
      },
      {
        type: "text",
        sourceBlockIndex: 0,
        id: "text-1",
        text: "done",
        sourceMessages: [anchor],
      },
      {
        type: "user_prompt",
        id: "user-2",
        content: "later",
        sourceMessages: [{ id: "user-2", type: "user" }],
      },
    ];

    const result = insertTranscriptDisplayObjects(items, [
      displayObject("display-1", "assistant-1"),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "thinking-1",
      "text-1",
      "display-1",
      "user-2",
    ]);
  });

  it("omits objects until their placement anchor is loaded", () => {
    const items: RenderItem[] = [
      {
        type: "user_prompt",
        id: "user-2",
        content: "later",
        sourceMessages: [{ id: "user-2", type: "user" }],
      },
    ];

    expect(
      insertTranscriptDisplayObjects(items, [
        displayObject("display-1", "assistant-1"),
      ]),
    ).toBe(items);
  });
});
