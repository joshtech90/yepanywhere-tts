import { ALL_PROVIDERS, type ProviderName } from "./types.js";

/**
 * Stable opener for YA's post-compact continuation turn. Transcript
 * projection hides user rows that start with this line so the replay is
 * model-visible and not painted as a user bubble.
 */
export const POST_COMPACT_REPLAY_PREAMBLE =
  "This session is being continued after compaction (Yep Anywhere replay).";

export const POST_COMPACT_REPLAY_CONTINUE = "continue.";

export const MAX_POST_COMPACT_REPLAY_TURNS = 20;
export const DEFAULT_POST_COMPACT_REPLAY_TURNS = 0;
export const MAX_POST_COMPACT_REPLAY_CHARS = 40_000;
export const MAX_POST_COMPACT_REPLAY_TURN_CHARS = 8_000;

export type PostCompactReplayTurn = {
  role: "user" | "assistant";
  text: string;
};

export type PostCompactReplaySettings = {
  /** Per-provider enablement. Absent or false means off. */
  providers?: Partial<Record<ProviderName, boolean>>;
  /**
   * Last N user/assistant prose turns to copy into the continuation.
   * 0 means send only the continue line.
   */
  replayTurnCount?: number;
};

export const DEFAULT_POST_COMPACT_REPLAY_SETTINGS: PostCompactReplaySettings = {
  providers: {},
  replayTurnCount: DEFAULT_POST_COMPACT_REPLAY_TURNS,
};

export function isPostCompactReplayText(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  return text.trimStart().startsWith(POST_COMPACT_REPLAY_PREAMBLE);
}

export function clampPostCompactReplayTurnCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_POST_COMPACT_REPLAY_TURNS;
  }
  return Math.min(MAX_POST_COMPACT_REPLAY_TURNS, Math.max(0, value));
}

export function isPostCompactReplayEnabledForProvider(
  settings: PostCompactReplaySettings | null | undefined,
  provider: ProviderName,
): boolean {
  return settings?.providers?.[provider] === true;
}

/**
 * Trim one replay turn and cap its length, marking a cut with the shared
 * truncated suffix. Every surface that stores or selects replay turns caps
 * through this function so the stored text and the quoted text agree.
 */
export function capTurnText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_POST_COMPACT_REPLAY_TURN_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_POST_COMPACT_REPLAY_TURN_CHARS)} …[truncated]`;
}

export function selectPostCompactReplayTurns(
  turns: readonly PostCompactReplayTurn[],
  replayTurnCount: number,
): PostCompactReplayTurn[] {
  const count = clampPostCompactReplayTurnCount(replayTurnCount);
  if (count <= 0) return [];
  const selected: PostCompactReplayTurn[] = [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) continue;
    const text = capTurnText(turn.text);
    if (!text || isPostCompactReplayText(text)) continue;
    selected.push({ role: turn.role, text });
    if (selected.length >= count) break;
  }
  return selected.reverse();
}

export type PostCompactReplayPrompt = {
  /** YA-authored framing, kept separate from historical conversation text. */
  instruction: string;
  quotedHistory: string;
  continuation: string;
};

export function buildPostCompactReplayPrompt(params: {
  provider: string;
  sessionId: string;
  turns: readonly PostCompactReplayTurn[];
}): PostCompactReplayPrompt {
  const body = params.turns
    .filter((turn) => turn.text.trim().length > 0)
    .map((turn) => `${turn.role}: ${turn.text}`)
    .join("\n\n");
  if (!body) {
    return {
      instruction: POST_COMPACT_REPLAY_PREAMBLE,
      quotedHistory: "",
      continuation: POST_COMPACT_REPLAY_CONTINUE,
    };
  }

  const instruction = `${POST_COMPACT_REPLAY_PREAMBLE}\nThe following quotation records before-compaction activity, not a new request. Original user/assistant roles are labeled; activity details are elided (see ${params.provider} session ${params.sessionId} if needed). Later user instructions take precedence over this historical excerpt.`;
  const continuation = `End of before-compaction quotation.\n\n${POST_COMPACT_REPLAY_CONTINUE}`;
  let quotedHistory = body
    .split(/\r\n|\r|\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  // Preserve the framing and continuation when the history reaches the cap.
  const budget =
    MAX_POST_COMPACT_REPLAY_CHARS -
    instruction.length -
    continuation.length -
    4;
  if (quotedHistory.length > budget) {
    const marker = "\n> …[truncated]";
    quotedHistory = `${quotedHistory.slice(0, Math.max(0, budget - marker.length))}${marker}`;
  }
  return { instruction, quotedHistory, continuation };
}

/** Ordinary provider delivery stays one message, with the quotation in scope. */
export function formatPostCompactReplayPrompt(
  prompt: PostCompactReplayPrompt,
): string {
  return [prompt.instruction, prompt.quotedHistory, prompt.continuation]
    .filter(Boolean)
    .join("\n\n");
}

export function buildPostCompactReplayText(
  params: Parameters<typeof buildPostCompactReplayPrompt>[0],
): string {
  return formatPostCompactReplayPrompt(buildPostCompactReplayPrompt(params));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a stored or submitted post-compact replay setting.
 * `null` means invalid. `undefined` input yields the default object.
 */
export function parsePostCompactReplaySettings(
  raw: unknown,
): PostCompactReplaySettings | null {
  if (raw === undefined || raw === null || raw === "") {
    return { ...DEFAULT_POST_COMPACT_REPLAY_SETTINGS, providers: {} };
  }
  if (!isRecord(raw)) return null;

  const providers: Partial<Record<ProviderName, boolean>> = {};
  if (
    "providers" in raw &&
    raw.providers !== undefined &&
    raw.providers !== null
  ) {
    if (!isRecord(raw.providers)) return null;
    for (const [name, enabled] of Object.entries(raw.providers)) {
      if (!ALL_PROVIDERS.includes(name as ProviderName)) return null;
      if (enabled === undefined || enabled === null) continue;
      if (typeof enabled !== "boolean") return null;
      if (enabled) {
        providers[name as ProviderName] = true;
      }
    }
  }

  let replayTurnCount = DEFAULT_POST_COMPACT_REPLAY_TURNS;
  if ("replayTurnCount" in raw && raw.replayTurnCount !== undefined) {
    if (
      typeof raw.replayTurnCount !== "number" ||
      !Number.isInteger(raw.replayTurnCount) ||
      raw.replayTurnCount < 0 ||
      raw.replayTurnCount > MAX_POST_COMPACT_REPLAY_TURNS
    ) {
      return null;
    }
    replayTurnCount = raw.replayTurnCount;
  }

  return { providers, replayTurnCount };
}
