import type { ClientSummarySourceKey } from "./clientSummaryStore";

const NEW_SESSION_PREFILL_KEY_PREFIX = "new-session-prefill:";
const NEW_SESSION_PREFILL_TOKEN_PREFIX = "new-session-prefill-token:";
const CARET_SUFFIX = ":caret";

export type NewSessionPrefillCaret = "start" | "end";

export interface NewSessionPrefillRecord {
  caret: NewSessionPrefillCaret;
  text: string;
}

function encodePrefillKeyPart(value: string): string {
  return encodeURIComponent(value);
}

export function createNewSessionPrefillKey(
  sourceKey: ClientSummarySourceKey,
): string {
  return `${NEW_SESSION_PREFILL_KEY_PREFIX}${encodePrefillKeyPart(sourceKey)}`;
}

function caretStorageKey(sourceKey: ClientSummarySourceKey): string {
  return `${createNewSessionPrefillKey(sourceKey)}${CARET_SUFFIX}`;
}

function readCaret(sourceKey: ClientSummarySourceKey): NewSessionPrefillCaret {
  if (typeof window === "undefined") return "end";
  return sessionStorage.getItem(caretStorageKey(sourceKey)) === "start"
    ? "start"
    : "end";
}

export function getNewSessionPrefill(
  sourceKey: ClientSummarySourceKey,
): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(createNewSessionPrefillKey(sourceKey));
}

export function clearNewSessionPrefill(
  sourceKey: ClientSummarySourceKey,
): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(createNewSessionPrefillKey(sourceKey));
  sessionStorage.removeItem(caretStorageKey(sourceKey));
}

export function setNewSessionPrefill(
  sourceKey: ClientSummarySourceKey,
  text: string,
  options?: { caret?: NewSessionPrefillCaret },
): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(createNewSessionPrefillKey(sourceKey), text);
  if (options?.caret === "start") {
    sessionStorage.setItem(caretStorageKey(sourceKey), "start");
  } else {
    sessionStorage.removeItem(caretStorageKey(sourceKey));
  }
}

export function consumeNewSessionPrefill(
  sourceKey: ClientSummarySourceKey,
): NewSessionPrefillRecord | null {
  const text = getNewSessionPrefill(sourceKey);
  if (text == null) return null;
  const caret = readCaret(sourceKey);
  clearNewSessionPrefill(sourceKey);
  return { text, caret };
}

export function stashNewSessionPrefillToken(
  sourceKey: ClientSummarySourceKey,
  text: string,
  options?: { caret?: NewSessionPrefillCaret },
): string {
  const token = crypto.randomUUID();
  if (typeof window !== "undefined") {
    localStorage.setItem(
      `${NEW_SESSION_PREFILL_TOKEN_PREFIX}${token}`,
      JSON.stringify({
        caret: options?.caret === "start" ? "start" : "end",
        sourceKey,
        text,
      }),
    );
  }
  return token;
}

export function consumeNewSessionPrefillToken(
  token: string,
  sourceKey: ClientSummarySourceKey,
): NewSessionPrefillRecord | null {
  if (typeof window === "undefined") return null;
  const storageKey = `${NEW_SESSION_PREFILL_TOKEN_PREFIX}${token}`;
  const raw = localStorage.getItem(storageKey);
  localStorage.removeItem(storageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      caret?: unknown;
      sourceKey?: unknown;
      text?: unknown;
    };
    if (parsed.sourceKey !== sourceKey || typeof parsed.text !== "string") {
      return null;
    }
    return {
      caret: parsed.caret === "start" ? "start" : "end",
      text: parsed.text,
    };
  } catch {
    return null;
  }
}
