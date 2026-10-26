import { describe, expect, it, vi } from "vitest";
import { compileTranscriptProjection } from "./compiler.js";
import type { Message } from "./message.js";

describe("tool result ordering", () => {
  const call: Message = {
    uuid: "call-1",
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "call-1", name: "Read", input: {} }],
    },
  };
  const result: Message = {
    uuid: "call-1-result",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call-1",
          content: "file contents",
        },
      ],
    },
  };
  const prompt: Message = {
    uuid: "prompt-1",
    type: "user",
    content: "Next request",
  };

  it("pairs an earlier result without moving the call across a user turn", () => {
    const unmatched = vi.fn();
    const messages = [result, prompt, call];
    for (let update = 0; update < 3; update++) {
      const items = compileTranscriptProjection([...messages], undefined, {
        onUnmatchedToolResult: unmatched,
      });
      expect(items).toMatchObject([
        { type: "user_prompt", id: "prompt-1" },
        {
          type: "tool_call",
          id: "call-1",
          status: "complete",
          toolResult: { content: "file contents", isError: false },
          sourceMessages: [call, result],
        },
      ]);
    }
    expect(unmatched).not.toHaveBeenCalled();
    expect(messages).toEqual([result, prompt, call]);
  });

  it.each([true, false])(
    "preserves streaming-to-final result order with an early result: %s",
    (early) => {
      const partial: Message = {
        ...result,
        uuid: "call-1-partial",
        _isStreaming: true,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call-1", content: "file" },
          ],
        },
      };
      const snapshot: Message = { ...call, uuid: "call-1-snapshot" };
      const unmatched = vi.fn();
      const messages = early
        ? [partial, prompt, call, result, snapshot]
        : [prompt, call, partial, result, snapshot];
      expect(
        compileTranscriptProjection(messages, undefined, {
          onUnmatchedToolResult: unmatched,
        }),
      ).toMatchObject([
        { type: "user_prompt", id: "prompt-1" },
        {
          type: "tool_call",
          id: "call-1",
          status: "complete",
          toolResult: { content: "file contents" },
        },
      ]);
      expect(unmatched).not.toHaveBeenCalled();
    },
  );

  it("still reports a result whose call is absent from the loaded window", () => {
    const unmatched = vi.fn();
    expect(
      compileTranscriptProjection([result, prompt], undefined, {
        onUnmatchedToolResult: unmatched,
      }),
    ).toMatchObject([{ type: "user_prompt", id: "prompt-1" }]);
    expect(unmatched).toHaveBeenCalledExactlyOnceWith({
      toolUseId: "call-1",
      message: result,
    });
  });
});
