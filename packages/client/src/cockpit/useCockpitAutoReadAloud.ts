import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { playReadAloud, stopReadAloud } from "../lib/readAloud";
import type {
  CockpitAssistantEntry,
  CockpitTranscriptEntry,
} from "./core/sessionDetail";

/**
 * Auto read-aloud for one Cockpit session, like PocketClaude's per-chat
 * switch: once a turn of the open session ends, its final answer is read
 * aloud through the shared read-aloud controller. The switch is remembered
 * per session on this device and does nothing for sessions that are not open.
 */

const STORAGE_KEY = "yep-cockpit-auto-read-sessions";
/** Oldest switched-on sessions drop out beyond this many. */
const MAX_REMEMBERED_SESSIONS = 200;
/**
 * The final answer can reach the transcript shortly after the session turns
 * idle; later than this it no longer belongs to the turn that just ended.
 */
const ANSWER_GRACE_MS = 15_000;

let remembered: string[] | null = null;
const listeners = new Set<() => void>();

function load(): string[] {
  if (remembered) return remembered;
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    remembered = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    remembered = [];
  }
  return remembered;
}

function store(next: string[]): void {
  remembered = next.slice(-MAX_REMEMBERED_SESSIONS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remembered));
  } catch {
    // Private mode or full storage: the switch still holds for this tab.
  }
  for (const listener of listeners) listener();
}

function setRemembered(sessionId: string, on: boolean): void {
  const rest = load().filter((id) => id !== sessionId);
  store(on ? [...rest, sessionId] : rest);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string[] {
  return load();
}

/** Test hook: forget the cached list so the next read hits localStorage. */
export function resetCockpitAutoReadCache(): void {
  remembered = null;
}

/**
 * The last transcript entry, when it is a finished, complete answer. Status
 * and compaction markers after it do not count as later output.
 */
export function finalCockpitAnswer(
  entries: readonly CockpitTranscriptEntry[],
): CockpitAssistantEntry | null {
  let index = entries.length - 1;
  while (entries[index]?.kind === "boundary") index--;
  const last = entries[index];
  if (last?.kind !== "assistant" || last.isStreaming) return null;
  if (!last.spokenText.trim()) return null;
  // A stopped answer is not the final one.
  if (last.text.some((segment) => segment.abortedMidStream)) return null;
  return last;
}

export interface CockpitAutoReadAloudInput {
  sessionId: string;
  /** Real provider id once a new session reports it; carries the switch. */
  actualSessionId?: string | null;
  entries: readonly CockpitTranscriptEntry[];
  /** Transcript for this session has loaded at least once. */
  loaded: boolean;
  /** The session works here or elsewhere, or waits for input. */
  working: boolean;
}

interface TurnWatch {
  sessionId: string;
  working: boolean;
  /** Key of the final answer when the turn began; undefined = unknown. */
  baseline: string | null | undefined;
  endedAt: number | null;
}

export function useCockpitAutoReadAloud({
  actualSessionId,
  entries,
  loaded,
  sessionId,
  working,
}: CockpitAutoReadAloudInput): { enabled: boolean; toggle: () => void } {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  const ownId = actualSessionId || sessionId;
  const enabled = list.includes(ownId) || list.includes(sessionId);

  // A new session runs under a temporary id first; the switch follows it to
  // the real one so it survives the address change.
  useEffect(() => {
    if (!actualSessionId || actualSessionId === sessionId) return;
    const current = load();
    if (!current.includes(sessionId)) return;
    store([
      ...current.filter((id) => id !== sessionId && id !== actualSessionId),
      actualSessionId,
    ]);
  }, [actualSessionId, sessionId]);

  const toggle = useCallback(() => {
    const next = !enabled;
    if (!next) {
      setRemembered(sessionId, false);
      stopReadAloud();
    }
    setRemembered(ownId, next);
  }, [enabled, ownId, sessionId]);

  const answer = finalCockpitAnswer(entries);
  const answerKey = answer?.key ?? null;
  const answerText = answer?.spokenText ?? "";
  const watchRef = useRef<TurnWatch | null>(null);

  useEffect(() => {
    let watch = watchRef.current;
    if (!watch || watch.sessionId !== sessionId) {
      // Opening a session never reads what was already there.
      watch = {
        sessionId,
        working: false,
        baseline: loaded ? answerKey : undefined,
        endedAt: null,
      };
      watchRef.current = watch;
    }
    if (working) {
      if (!watch.working) {
        watch.working = true;
        watch.baseline = loaded ? answerKey : undefined;
      } else if (watch.baseline === undefined && loaded) {
        watch.baseline = answerKey;
      }
      watch.endedAt = null;
      return;
    }
    if (watch.working) {
      watch.working = false;
      watch.endedAt = Date.now();
    }
    if (watch.endedAt === null) return;
    if (!enabled || !loaded || watch.baseline === undefined) {
      watch.endedAt = null;
      return;
    }
    if (Date.now() - watch.endedAt > ANSWER_GRACE_MS) {
      watch.endedAt = null;
      return;
    }
    if (!answerKey || answerKey === watch.baseline) return;
    watch.endedAt = null;
    watch.baseline = answerKey;
    void playReadAloud(answerText, answerKey);
  }, [answerKey, answerText, enabled, loaded, sessionId, working]);

  return { enabled, toggle };
}
