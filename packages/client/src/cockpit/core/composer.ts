import type { UserMessageMetadata } from "@yep-anywhere/shared";

export type CockpitComposerAction = "send" | "steer" | "queue";

const PROMPT_HISTORY_KEY = "yep-anywhere-cockpit-prompts";
const PROMPT_HISTORY_VERSION = 1;

export interface CockpitPromptHistoryEntry {
  text: string;
  usedAt: string;
}

interface CockpitPromptHistoryRecord {
  version: 1;
  sources: Record<string, CockpitPromptHistoryEntry[]>;
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
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CockpitPromptHistoryRecord>;
    if (parsed.version !== PROMPT_HISTORY_VERSION || !parsed.sources) return [];
    const entries = parsed.sources[sourceKey];
    return Array.isArray(entries)
      ? entries.filter(
          (entry): entry is CockpitPromptHistoryEntry =>
            typeof entry?.text === "string" && typeof entry.usedAt === "string",
        )
      : [];
  } catch {
    return [];
  }
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
    const next = [
      { text: prompt, usedAt },
      ...current.filter((entry) => entry.text !== prompt),
    ].slice(0, 20);
    const raw = localStorage.getItem(PROMPT_HISTORY_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Partial<CockpitPromptHistoryRecord>)
      : undefined;
    const sources =
      parsed?.version === PROMPT_HISTORY_VERSION && parsed.sources
        ? parsed.sources
        : {};
    const record: CockpitPromptHistoryRecord = {
      version: PROMPT_HISTORY_VERSION,
      sources: { ...sources, [sourceKey]: next },
    };
    localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(record));
  } catch {
    // Prompt recall is optional; delivery remains available without storage.
  }
}
