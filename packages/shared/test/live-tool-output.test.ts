import { describe, expect, it } from "vitest";
import {
  isLiveToolOutputMessage,
  TOOL_OUTPUT_PREVIEW_MESSAGE_TYPE,
} from "../src/live-tool-output.js";
import { projectTranscriptMessages } from "../src/transcript/messageProjection.js";

const toolUse = {
  type: "assistant",
  uuid: "use-1",
  message: {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "call-1",
        name: "Bash",
        input: { command: "make" },
      },
    ],
  },
};

function toolResult(uuid: string, content: string, streaming: boolean) {
  return {
    type: "user",
    uuid,
    ...(streaming ? { _isStreaming: true } : {}),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call-1", content }],
    },
  };
}

function project(messages: unknown[]) {
  return projectTranscriptMessages(messages as never).map((item) => ({
    status: (item as { status?: string }).status,
    content: (item as { toolResult?: { content?: string } }).toolResult
      ?.content,
  }));
}

describe("live tool output", () => {
  it("covers Claude previews and streaming tool results only", () => {
    expect(
      isLiveToolOutputMessage({ type: TOOL_OUTPUT_PREVIEW_MESSAGE_TYPE }),
    ).toBe(true);
    expect(isLiveToolOutputMessage(toolResult("r", "out", true))).toBe(true);
    expect(isLiveToolOutputMessage(toolResult("r", "out", false))).toBe(false);
    expect(
      isLiveToolOutputMessage({
        type: "assistant",
        _isStreaming: true,
        message: { role: "assistant", content: "partial" },
      }),
    ).toBe(false);
  });

  it("keeps a call pending while its output streams, then completes it", () => {
    expect(project([toolUse, toolResult("live", "building…", true)])).toEqual([
      { status: "pending", content: "building…" },
    ]);
    expect(
      project([
        toolUse,
        toolResult("live", "building…", true),
        toolResult("final", "built", false),
      ]),
    ).toEqual([{ status: "complete", content: "built" }]);
  });
});
