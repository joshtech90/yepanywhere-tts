import type { UserMessageMetadata } from "@yep-anywhere/shared";

export type CockpitComposerAction = "send" | "steer" | "queue";

const PROMPT_HISTORY_KEY = "yep-anywhere-cockpit-prompts";
const PROMPT_HISTORY_VERSION = 2;

export interface CockpitPromptHistoryEntry {
  text: string;
  usedAt: string;
  useCount: number;
}

interface CockpitPromptHistoryRecord {
  version: 2;
  sources: Record<string, CockpitPromptHistoryEntry[]>;
}

function normalizePromptEntries(
  value: unknown,
  version: 1 | 2,
): CockpitPromptHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<CockpitPromptHistoryEntry>;
    if (
      typeof candidate.text !== "string" ||
      typeof candidate.usedAt !== "string"
    ) {
      return [];
    }
    if (version === 1) {
      return [{ text: candidate.text, usedAt: candidate.usedAt, useCount: 1 }];
    }
    if (
      typeof candidate.useCount !== "number" ||
      !Number.isFinite(candidate.useCount) ||
      candidate.useCount <= 0
    ) {
      return [];
    }
    return [
      {
        text: candidate.text,
        usedAt: candidate.usedAt,
        useCount: candidate.useCount,
      },
    ];
  });
}

function readCockpitPromptSources(): Record<
  string,
  CockpitPromptHistoryEntry[]
> {
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      sources?: unknown;
    };
    if (
      (parsed.version !== 1 && parsed.version !== PROMPT_HISTORY_VERSION) ||
      !parsed.sources ||
      typeof parsed.sources !== "object"
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed.sources).map(([sourceKey, entries]) => [
        sourceKey,
        normalizePromptEntries(entries, parsed.version as 1 | 2),
      ]),
    );
  } catch {
    return {};
  }
}

export interface CockpitComposerActionState {
  busy: boolean;
  primary: CockpitComposerAction;
  canQueue: boolean;
  canSteer: boolean;
}

export function deriveCockpitComposerActions(input: {
  processState: "idle" | "in-turn" | "waiting-input";
  supportsSteering: boolean;
}): CockpitComposerActionState {
  const busy = input.processState !== "idle";
  const canSteer = busy && input.supportsSteering;
  return {
    busy,
    primary: canSteer ? "steer" : busy ? "queue" : "send",
    canQueue: busy,
    canSteer,
  };
}

export function createCockpitSubmissionMetadata(input: {
  action: CockpitComposerAction;
  typingStartedAt: string | null;
  lastEditedAt: string | null;
  submittedAt: string;
  steerNow?: boolean;
}): UserMessageMetadata {
  return {
    deliveryIntent:
      input.action === "send"
        ? "direct"
        : input.action === "steer"
          ? "steer"
          : "deferred",
    ...(input.action === "steer" && input.steerNow
      ? { steerNow: true }
      : {}),
    composition: {
      typingStartedAt: input.typingStartedAt ?? input.submittedAt,
      typingEndedAt: input.submittedAt,
      lastEditedAt:
        input.lastEditedAt ?? input.typingStartedAt ?? input.submittedAt,
      submittedAt: input.submittedAt,
    },
  };
}

export function cockpitComposerDraftKey(
  sourceKey: string,
  sessionId: string,
): string {
  return `yep-anywhere-cockpit-composer:v1:${sourceKey}:${sessionId}`;
}

export function readCockpitComposerDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeCockpitComposerDraft(key: string, draft: string): void {
  try {
    if (draft) localStorage.setItem(key, draft);
    else localStorage.removeItem(key);
  } catch {
    // A blocked/full browser store must not disable the composer.
  }
}

export function readCockpitPromptHistory(
  sourceKey: string,
): CockpitPromptHistoryEntry[] {
  return readCockpitPromptSources()[sourceKey] ?? [];
}

export function rememberCockpitPrompt(
  sourceKey: string,
  text: string,
  usedAt = new Date().toISOString(),
): void {
  const prompt = text.trim();
  if (!prompt) return;
  try {
    const current = readCockpitPromptHistory(sourceKey);
    const previous = current.find((entry) => entry.text === prompt);
    const next = [
      { text: prompt, usedAt, useCount: (previous?.useCount ?? 0) + 1 },
      ...current.filter((entry) => entry.text !== prompt),
    ].slice(0, 20);
    const sources = readCockpitPromptSources();
    const record: CockpitPromptHistoryRecord = {
      version: PROMPT_HISTORY_VERSION,
      sources: { ...sources, [sourceKey]: next },
    };
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(record));
  } catch {
    // Prompt recall is optional; delivery remains available without storage.
  }
}

export function frequentCockpitPrompts(
  entries: readonly CockpitPromptHistoryEntry[],
  limit = 3,
): CockpitPromptHistoryEntry[] {
  return [...entries]
    .filter((entry) => entry.useCount > 1)
    .sort((left, right) => {
      if (left.useCount !== right.useCount) {
        return right.useCount - left.useCount;
      }
      return Date.parse(right.usedAt) - Date.parse(left.usedAt);
    })
    .slice(0, limit);
}

export function removeCockpitPrompt(
  sourceKey: string,
  text: string,
): CockpitPromptHistoryEntry[] {
  const current = readCockpitPromptHistory(sourceKey);
  const next = current.filter((entry) => entry.text !== text);
  writeCockpitPromptSource(sourceKey, next);
  return next;
}

function writeCockpitPromptSource(
  sourceKey: string,
  entries: CockpitPromptHistoryEntry[],
): void {
  try {
    const sources = readCockpitPromptSources();
    localStorage.setItem(
      PROMPT_HISTORY_KEY,
      JSON.stringify({
        version: PROMPT_HISTORY_VERSION,
        sources: { ...sources, [sourceKey]: entries },
      } satisfies CockpitPromptHistoryRecord),
    );
  } catch {
    // Prompt recall is optional; the composer remains usable.
  }
}

export function removeCockpitPromptHistorySource(sourceKey: string): void {
  try {
    const sources = readCockpitPromptSources();
    if (!sources[sourceKey]) return;
    delete sources[sourceKey];
    localStorage.setItem(
      PROMPT_HISTORY_KEY,
      JSON.stringify({
        version: PROMPT_HISTORY_VERSION,
        sources,
      } satisfies CockpitPromptHistoryRecord),
    );
  } catch {
    // Host removal must still succeed if browser storage is unavailable.
  }
}
