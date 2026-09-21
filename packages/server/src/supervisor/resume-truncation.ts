/**
 * Same-session rewind at the process-activation seam.
 *
 * A rewind arms a pending truncating resume in session metadata; whichever
 * path next starts a Claude process for that session must apply it (the
 * `/resume` route, Project Queue dispatch, heartbeat and wake turns,
 * reactivate, a settings restart). The supervisor calls this at the single
 * point every one of those paths passes through, so the process can never
 * replay a tail the session view shows as dropped. Contract:
 * topics/session-rewind.md § Server rewind operation.
 */

import {
  isClaudeProviderName,
  type ProviderName,
  type SessionPendingRewind,
} from "@yep-anywhere/shared";
import type { SDKMessage } from "../sdk/types.js";

export interface ResumeTruncation {
  resumeSessionAt?: string;
  resumeDropsTurn?: string;
  /** The rewind record this launch applies; cleared as pending once started. */
  rewindRecordId?: string;
}

/**
 * The truncation a provider launch passes to `startSession`. A pending
 * rewind wins over a caller-supplied truncation (the API-error tail cut in
 * the `/resume` route): its cut is already a completed boundary and the
 * record is what the session view displays.
 */
export function resolveResumeTruncation(input: {
  resumeSessionId: string | undefined;
  providerName: ProviderName;
  pendingRewind: SessionPendingRewind | undefined;
  requested?: { resumeSessionAt?: string; resumeDropsTurn?: string };
}): ResumeTruncation {
  if (!input.resumeSessionId) return {};
  if (input.pendingRewind && isClaudeProviderName(input.providerName)) {
    return {
      resumeSessionAt: input.pendingRewind.cutMessageId,
      resumeDropsTurn: input.pendingRewind.dropsTurnPromptId,
      rewindRecordId: input.pendingRewind.recordId,
    };
  }
  const resumeSessionAt = input.requested?.resumeSessionAt;
  if (!resumeSessionAt) return {};
  return {
    resumeSessionAt,
    resumeDropsTurn: input.requested?.resumeDropsTurn,
  };
}

/**
 * The Claude CLI refuses a guarded truncation (`resumeDropsTurn`) with an
 * `error_during_execution` result whose message carries this prefix. The
 * refusal is deterministic: the same rewind can never succeed, so its record
 * is deleted and the next send resumes plainly.
 */
export const RESUME_DROPS_TURN_REFUSAL_PREFIX =
  "Resume rejected by --resume-drops-turn:";

export function isResumeDropsTurnRefusal(message: SDKMessage): boolean {
  if (message.type !== "result") return false;
  const texts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(push);
  };
  push(message.result);
  push(message.errors);
  push(message.error);
  return texts.some((text) => text.includes(RESUME_DROPS_TURN_REFUSAL_PREFIX));
}
