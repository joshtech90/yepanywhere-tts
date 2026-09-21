/**
 * Turn ordinals over the full session sequence (topics/session-rewind.md
 * § Vocabulary): every real user turn ever made, in transcript order,
 * including turns a same-session rewind later grouped. The ordinal is stamped
 * on the message as `turnIndex` during normalization, so the turn menu's
 * `[N]` tooltip and `/clear N` resolve through one mapping and the number
 * never renumbers.
 */

import { isPostCompactReplayText } from "@yep-anywhere/shared";
import type { Message } from "../supervisor/types.js";

function messageRole(message: Message): string | undefined {
  const nested = message.message as { role?: unknown } | undefined;
  if (typeof nested?.role === "string") return nested.role;
  if (typeof message.role === "string") return message.role;
  return message.type;
}

function messageContent(message: Message): unknown {
  const nested = message.message as { content?: unknown } | undefined;
  return nested?.content ?? (message as { content?: unknown }).content;
}

function contentHasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "tool_result",
    )
  );
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("\n");
}

/** A turn the user authored: the unit `N` counts. */
export function isRealUserTurn(message: Message): boolean {
  if (messageRole(message) !== "user") return false;
  if (message.isSynthetic === true) return false;
  if ((message as { isCompactSummary?: unknown }).isCompactSummary === true) {
    return false;
  }
  const content = messageContent(message);
  if (contentHasToolResult(content)) return false;
  const text = textContent(content);
  if (
    (message as { isMeta?: unknown }).isMeta === true &&
    text.trimStart().startsWith("Base directory for this skill:")
  ) {
    return false;
  }
  if (isPostCompactReplayText(text)) return false;
  return true;
}

/**
 * Stamp `turnIndex` (1-based, full-sequence) on every real user turn, in
 * place: normalized messages are freshly built or cache-owned objects, and
 * some providers key side tables (Codex source cursors) by object identity,
 * so cloning would strand them. Returns the same array.
 */
export function stampTurnIndexes(messages: Message[]): Message[] {
  let ordinal = 0;
  for (const message of messages) {
    if (!isRealUserTurn(message)) continue;
    ordinal += 1;
    (message as { turnIndex?: number }).turnIndex = ordinal;
  }
  return messages;
}

/** The stamped ordinal of a message, when it is a real user turn. */
export function turnIndexOf(message: Message | undefined): number | undefined {
  const value = (message as { turnIndex?: unknown } | undefined)?.turnIndex;
  return typeof value === "number" ? value : undefined;
}
