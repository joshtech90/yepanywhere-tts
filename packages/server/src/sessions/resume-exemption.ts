/**
 * Resume exemption for explicitly killed or locally completed sessions.
 *
 * When the user kills a session through YA's explicit Kill action, the
 * session must not come back through an automatic YA resume path. The durable
 * exemption lives in YA metadata and is checked by every automatic process-
 * start path. Provider transcripts remain untouched so history stays readable
 * and the user can deliberately continue the session.
 *
 * See topics/session-liveness.md and topics/heartbeat.md ("Automatic resume
 * exemptions").
 */

import type { SessionMetadata } from "../metadata/SessionMetadataService.js";

/** Whether YA may start a provider process without a fresh user action. */
export function isAutomaticSessionResumeAllowed(
  metadata:
    | Pick<
        SessionMetadata,
        "autoResumeDisabled" | "automationPausedUntilUserTurn"
      >
    | undefined,
): boolean {
  return (
    metadata?.autoResumeDisabled !== true &&
    metadata?.automationPausedUntilUserTurn !== true
  );
}

/** Outcome of blocking auto-resume for an explicitly killed session. */
export interface ResumeExemptionResult {
  /** Legacy response field; false after synthetic heartbeat retirement. */
  heartbeatDisabled: boolean;
  /** Whether YA's durable automatic-resume gate is blocked. */
  autoResumeDisabled: boolean;
  /** Present when shutdown succeeded but the durable exemption failed. */
  error?: string;
}
