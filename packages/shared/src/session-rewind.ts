/**
 * Same-session rewind, `/clear N`, and `/clearloop` contracts.
 * See topics/session-rewind.md.
 */

export const DEFAULT_CLEARLOOP_INACTIVITY_SECONDS = 60;
export const MIN_CLEARLOOP_INACTIVITY_SECONDS = 10;
export const MAX_CLEARLOOP_INACTIVITY_SECONDS = 60 * 60;

export function clampClearloopInactivitySeconds(
  value: unknown,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(
    MAX_CLEARLOOP_INACTIVITY_SECONDS,
    Math.max(MIN_CLEARLOOP_INACTIVITY_SECONDS, Math.round(value)),
  );
}

/**
 * Parse a duration such as `45s`, `2m`, `1.5h`, or a bare number of seconds.
 * Returns whole seconds, or null for anything else.
 */
export function parseDurationSeconds(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([smh]?)\s*$/i.exec(text);
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return Math.round(amount * multiplier);
}

/** Format whole seconds as the shortest exact `s`/`m`/`h` form. */
export function formatDurationSeconds(seconds: number): string {
  if (seconds % 3600 === 0 && seconds !== 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0 && seconds !== 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export type SessionRewindReason = "clear" | "clearloop";

/**
 * One in-place rewind of a session. The dropped tail stays in the provider
 * transcript as a dead branch; this record is what lets the reader show it as
 * a collapsed group instead of hiding it, and what the next resume consumes
 * to truncate the live conversation.
 */
export interface SessionRewindRecord {
  id: string;
  /** ISO time the rewind was recorded. */
  at: string;
  /** Last kept chain entry (provider message uuid on Claude). */
  cutMessageId: string;
  /** Turn index of the last kept user turn; 0 for the empty prefix. */
  cutTurnIndex: number;
  /** First dropped user request, when the tail had one. */
  droppedFromMessageId?: string;
  droppedTurnCount: number;
  reason: SessionRewindReason;
  /** For clearloop rewinds: the loop, the iteration, and its M and prompt. */
  clearloopId?: string;
  clearloopIteration?: number;
  clearloopTotal?: number;
  clearloopPrompt?: string;
}

/** A recorded rewind the next provider resume must apply. */
export interface SessionPendingRewind {
  recordId: string;
  cutMessageId: string;
  /** Prompt uuid of the single dropped turn, for the SDK's drop guard. */
  dropsTurnPromptId?: string;
}

export type SessionClearloopState =
  | "running"
  | "completed"
  | "cancelled"
  | "interrupted";

export interface SessionClearloopJob {
  id: string;
  cutMessageId: string;
  cutTurnIndex: number;
  prompt: string;
  /** M */
  total: number;
  /** m: iterations whose inactivity window has elapsed. */
  completed: number;
  /** Iteration currently in flight (1-based), when running. */
  currentIteration?: number;
  state: SessionClearloopState;
  /**
   * Patient loops also wait for the project idle predicate before starting the
   * next iteration, not only for this session's inactivity window.
   */
  patient?: boolean;
  startedAt: string;
  /** When the current iteration's prompt was sent. */
  iterationSentAt?: string;
  endedAt?: string;
  error?: string;
  /** The verbatim command line, reproduced in the durable notice. */
  commandText: string;
}

/**
 * What a session summary carries about its running `/clearloop`, enough for
 * the remaining-count badge and its contract tooltip.
 */
export interface SessionClearloopBadge {
  remaining: number;
  total: number;
  completed: number;
  cutTurnIndex: number;
  prompt: string;
  /** Inactivity window in seconds, when the producer knows it. */
  windowSeconds?: number;
  /** The loop waits for project idleness too; the badge reads purple. */
  patient?: boolean;
}

/** Synthetic system subtype that heads a rewound group in the transcript. */
export const REWOUND_GROUP_SUBTYPE = "rewound_group";

/** Runtime controls on a running loop, beyond cancel. */
export interface UpdateClearloopRequest {
  /** Turn the project-idle wait on or off for the next boundary. */
  patient?: boolean;
  /** End the current iteration now, skipping the window and any wait. */
  startNow?: boolean;
}

export interface ClearloopCommandArguments {
  /** Absent when the loop starts at the current position. */
  turnIndex?: number;
  total: number;
  prompt: string;
}

/**
 * Parse the argument text of `/clearloop [N] M: <prompt>`.
 * Returns null when the shape is wrong; callers report the syntax.
 */
export function parseClearloopArguments(
  argument: string,
): ClearloopCommandArguments | null {
  const match = /^\s*(?:(\d+)\s+)?(\d+)\s*:\s*([\s\S]*)$/.exec(argument);
  if (!match) return null;
  const total = Number.parseInt(match[2] ?? "", 10);
  const prompt = (match[3] ?? "").trim();
  if (!Number.isFinite(total) || total < 1 || !prompt) return null;
  const turnIndexText = match[1];
  if (turnIndexText === undefined) {
    return { total, prompt };
  }
  const turnIndex = Number.parseInt(turnIndexText, 10);
  if (!Number.isFinite(turnIndex) || turnIndex < 0) return null;
  return { turnIndex, total, prompt };
}

/** Parse the argument of `/clear [N]` or `/fork N`; bare `/clear` is 0. */
export function parseTurnIndexArgument(
  argument: string,
  options: { allowEmpty: boolean },
): number | null {
  const trimmed = argument.trim();
  if (!trimmed) return options.allowEmpty ? 0 : null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}
