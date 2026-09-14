import type { Message } from "../types";
import { isUnconfirmedSelfSend } from "./deliveryState";
import { stripQueuedTurnMarkers } from "./queuedTurnMarkers";
import { turnContentText } from "./sessionMessageText";

/**
 * Reconciling a post-submit recovery draft against proven-sent turns.
 *
 * `clearInput` empties the composer optimistically but keeps the text in the
 * draft envelope marked `pendingSend`, so a send that never landed is still
 * recoverable from a reload or a second tab. Nothing removes that copy except
 * the submitting tab's own `confirmInputClear`, so a sibling tab opened before
 * that confirm — or after the submitting tab died mid-POST — hydrates its
 * composer with text the session already contains as a real turn.
 *
 * The discard bar is proof, not a guess: the same text must appear either as a
 * durable user turn in the transcript tail or in the server-held queue. An
 * unproven recovery copy stays visible, and a draft the user typed or recalled
 * carries no `pendingSend` marker and is never considered here at all.
 */

/** Bounded tail scan; a recovery copy only ever matches a very recent turn. */
const SENT_TURN_SCAN_LIMIT = 50;

export interface QueuedSubmissionLike {
  content: string;
}

function normalizeForComparison(text: string): string {
  return stripQueuedTurnMarkers(text).trim();
}

function confirmedUserTurnText(message: Message): string | null {
  if (message.type !== "user" || isUnconfirmedSelfSend(message)) {
    return null;
  }
  const text = normalizeForComparison(
    turnContentText(message.message?.content ?? message.content),
  );
  return text || null;
}

/**
 * True when `draftText` is already accounted for by the session: a durable
 * user turn in the recent tail, or a message the server holds in its queue.
 * Comparison is exact after trimming and queued-turn-marker removal, so any
 * transformation YA applied on the way out (appended attachment mentions, for
 * example) yields no match and leaves the draft in place.
 */
export function draftTextIsAccountedFor(options: {
  draftText: string;
  messages: readonly Message[];
  deferredMessages?: readonly QueuedSubmissionLike[];
}): boolean {
  const draftText = normalizeForComparison(options.draftText);
  if (!draftText) {
    return false;
  }

  for (const deferred of options.deferredMessages ?? []) {
    if (normalizeForComparison(deferred.content) === draftText) {
      return true;
    }
  }

  const { messages } = options;
  const start = Math.max(0, messages.length - SENT_TURN_SCAN_LIMIT);
  for (let index = messages.length - 1; index >= start; index -= 1) {
    const message = messages[index];
    if (message && confirmedUserTurnText(message) === draftText) {
      return true;
    }
  }

  return false;
}
