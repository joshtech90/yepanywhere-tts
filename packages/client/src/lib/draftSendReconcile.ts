import type { Message } from "../types";
import { isUnconfirmedSelfSend } from "./deliveryState";
import { stripQueuedTurnMarkers } from "./queuedTurnMarkers";
import { turnContentText } from "./sessionMessageText";

/**
 * Reconciling a post-submit recovery draft against proven-sent turns.
 *
 * `clearInput` empties the composer optimistically but keeps the text in the
 * draft envelope marked with its send time (`pendingSendAt`), so a send that
 * never landed is still recoverable from a reload or a second tab. Nothing
 * removes that copy except the submitting tab's own `confirmInputClear`, so a
 * sibling tab opened before that confirm — or after the submitting tab died
 * mid-POST — hydrates its composer with text the session already contains as
 * a real turn.
 *
 * The discard bar is proof, not a guess: the same text must appear, dated no
 * earlier than the send, either as a durable user turn in the transcript tail
 * or in the server-held queue. Short prompts repeat ("continue", "yes"), so an
 * older identical turn proves nothing about this send. An unproven recovery
 * copy stays visible, and a draft the user typed or recalled carries no marker
 * and is never considered here at all.
 */

/** Bound by user prompts; tool results must not age a sent prompt out. */
const SENT_TURN_SCAN_LIMIT = 50;

/**
 * How far before the recorded send a turn's timestamp may fall and still be
 * that send. The send time is the client's estimate of the server clock, and
 * the server or provider stamps the turn after receiving it, so honest proof
 * lands at or after the send up to estimate error. Missing proof only leaves a
 * stale copy visible, while an over-wide window lets an earlier identical
 * prompt erase an unsent one, so the tolerance stays tight.
 */
const SENT_TURN_CLOCK_SKEW_MS = 5_000;

export interface QueuedSubmissionLike {
  content: string;
  timestamp: string;
}

function normalizeForComparison(text: string): string {
  return stripQueuedTurnMarkers(text).trim();
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
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
 * True when the send of `draftText` at `sentAtMs` (server clock) is already
 * accounted for by the session: a durable user turn in the recent tail, or a
 * message the server holds in its queue, with the same text and a timestamp no
 * earlier than that send. Comparison is exact after trimming and queued-turn
 * marker removal, so any transformation YA applied on the way out (appended
 * attachment mentions, for example) yields no match and leaves the draft in
 * place, as does evidence with no readable timestamp.
 */
export function draftTextIsAccountedFor(options: {
  draftText: string;
  sentAtMs: number;
  messages: readonly Message[];
  deferredMessages?: readonly QueuedSubmissionLike[];
}): boolean {
  const draftText = normalizeForComparison(options.draftText);
  if (!draftText) {
    return false;
  }
  const earliestProofMs = options.sentAtMs - SENT_TURN_CLOCK_SKEW_MS;
  const datedFromThisSend = (value: unknown): boolean => {
    const ms = timestampMs(value);
    return ms !== null && ms >= earliestProofMs;
  };

  for (const deferred of options.deferredMessages ?? []) {
    if (
      normalizeForComparison(deferred.content) === draftText &&
      datedFromThisSend(deferred.timestamp)
    ) {
      return true;
    }
  }

  const { messages } = options;
  let prompts = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const text = message ? confirmedUserTurnText(message) : null;
    if (text === null) continue;
    if (text === draftText && datedFromThisSend(message?.timestamp)) {
      return true;
    }
    if (++prompts >= SENT_TURN_SCAN_LIMIT) break;
  }

  return false;
}
