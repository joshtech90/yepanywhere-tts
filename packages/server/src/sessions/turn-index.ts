/**
 * Turn ordinals over the full session sequence (topics/session-rewind.md
 * § Vocabulary): every real user turn ever made, in transcript order,
 * including turns a same-session rewind later grouped. The ordinal is stamped
 * on the message as `turnIndex` during normalization, so the turn menu's
 * `[N]` tooltip and `/clear N` resolve through one mapping and the number
 * never renumbers. Which rows are turns is the shared `isRealUserTurn`, the
 * same predicate the client numbers not-yet-persisted stream rows with.
 */

import { isRealUserTurn } from "@yep-anywhere/shared/transcript/messageProjection";
import type { Message } from "../supervisor/types.js";

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
