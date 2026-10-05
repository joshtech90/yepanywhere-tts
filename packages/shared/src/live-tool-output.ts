/**
 * Live tool output: what a running tool call has printed so far, delivered
 * while it runs and superseded by its result. Claude sessions carry it as
 * `tool_output_preview` messages; Codex sessions as streaming tool results.
 * Subscribers that decline it (`wantsLiveToolOutput: false`) are not sent
 * either, and it never reaches the model.
 */

export const TOOL_OUTPUT_PREVIEW_MESSAGE_TYPE = "tool_output_preview";

function hasToolResultBlock(message: Record<string, unknown>): boolean {
  const inner = message.message;
  const content =
    inner && typeof inner === "object"
      ? (inner as { content?: unknown }).content
      : undefined;
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "tool_result",
    )
  );
}

export function isLiveToolOutputMessage(
  message: Record<string, unknown>,
): boolean {
  if (message.type === TOOL_OUTPUT_PREVIEW_MESSAGE_TYPE) return true;
  return (
    message._isStreaming === true &&
    message.type === "user" &&
    hasToolResultBlock(message)
  );
}
