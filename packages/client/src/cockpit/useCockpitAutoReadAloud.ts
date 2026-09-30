import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { playReadAloud, stopReadAloud } from "../lib/readAloud";
import type { CockpitTranscriptEntry } from "./core/sessionDetail";

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

export interface CockpitFinalAnswer {
  /** Id of the answer's last text block; changes with every new message. */
  key: string;
  /** Transcript entry holding the answer; its read-aloud control uses it. */
  entryKey: string;
  text: string;
}

/**
 * The final answer of the transcript: the last provider message of the last
 * entry, when that entry is a finished, complete answer. Earlier messages
 * grouped into the same entry are commentary and stay unread. Status and
 * compaction markers after it do not count as later output.
 */
export function finalCockpitAnswer(
  entries: readonly CockpitTranscriptEntry[],
): CockpitFinalAnswer | null {
  let index = entries.length - 1;
  while (entries[index]?.kind === "boundary") index--;
  const last = entries[index];
  if (last?.kind !== "assistant" || last.isStreaming) return null;
  // A stopped answer is not the final one.
  if (last.text.some((segment) => segment.abortedMidStream)) return null;
  const segment = last.text[last.text.length - 1];
  if (!segment) return null;
  const source = last.sourceItems?.find((item) => item.id === segment.id)
    ?.sourceMessages[0];
  const sameMessage = source
    ? new Set(
        last.sourceItems
          ?.filter((item) => item.sourceMessages[0] === source)
          .map((item) => item.id),
      )
    : new Set([segment.id]);
  const text = last.text
    .filter((part) => sameMessage.has(part.id))
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  return text ? { key: segment.id, entryKey: last.key, text } : null;
}

export interface CockpitAutoReadAloudInput {
  sessionId: string;
  /** Real provider id once a new session reports it; carries the switch. */
  actualSessionId?: string | null;
  entries: readonly CockpitTranscriptEntry[];
  /** The latest turn ended in an abort rather than an answer. */
  aborted?: boolean;
  /** Transcript for this session has loaded at least once. */
  loaded: boolean;
  /** The session works here or elsewhere, or waits for input. */
  working: boolean;
  /** The work happens in another program, seen only through the transcript. */
  workingElsewhere?: boolean;
}

/**
 * Idle and the transcript arrive separately, so the answer has to hold still
 * this long before it counts as final.
 */
export const COCKPIT_AUTO_READ_SETTLE_MS = 1_500;
/**
 * Another program's turn looks idle whenever its latest text is finished,
 * even between that text and its next tool call; wait longer there.
 */
export const COCKPIT_AUTO_READ_EXTERNAL_SETTLE_MS = 8_000;

interface TurnWatch {
  sessionId: string;
  working: boolean;
  external: boolean;
  /** Key of the final answer when the turn began; undefined = unknown. */
  baseline: string | null | undefined;
  endedAt: number | null;
}

export function useCockpitAutoReadAloud({
  aborted = false,
  actualSessionId,
  entries,
  loaded,
  sessionId,
  working,
  workingElsewhere = false,
}: CockpitAutoReadAloudInput): {
  enabled: boolean;
  /** Leave the current turn unread, for example after the user stops it. */
  skipTurn: () => void;
  toggle: () => void;
} {
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

  const answer = useMemo(() => finalCockpitAnswer(entries), [entries]);
  const answerKey = answer?.key ?? null;
  const answerText = answer?.text ?? "";
  const answerEntryKey = answer?.entryKey ?? "";
  const watchRef = useRef<TurnWatch | null>(null);
  const skippedRef = useRef(false);

  const skipTurn = useCallback(() => {
    skippedRef.current = true;
  }, []);

  useEffect(() => {
    let watch = watchRef.current;
    if (!watch || watch.sessionId !== sessionId) {
      // Opening a session never reads what was already there.
      watch = {
        sessionId,
        working: false,
        external: false,
        baseline: loaded ? answerKey : undefined,
        endedAt: null,
      };
      watchRef.current = watch;
      skippedRef.current = false;
    }
    if (working) {
      if (!watch.working) {
        watch.working = true;
        watch.external = false;
        watch.baseline = loaded ? answerKey : undefined;
        skippedRef.current = false;
      } else if (watch.baseline === undefined && loaded) {
        watch.baseline = answerKey;
      }
      if (workingElsewhere) watch.external = true;
      watch.endedAt = null;
      return;
    }
    if (watch.working) {
      watch.working = false;
      watch.endedAt = Date.now();
    }
    const endedAt = watch.endedAt;
    if (endedAt === null) return;
    if (
      !enabled ||
      !loaded ||
      aborted ||
      skippedRef.current ||
      watch.baseline === undefined ||
      Date.now() - endedAt > ANSWER_GRACE_MS
    ) {
      watch.endedAt = null;
      return;
    }
    if (!answerKey || answerKey === watch.baseline) return;
    // Any change before the timer fires re-runs this effect and restarts it.
    const settleMs = watch.external
      ? COCKPIT_AUTO_READ_EXTERNAL_SETTLE_MS
      : COCKPIT_AUTO_READ_SETTLE_MS;
    const current = watch;
    const timer = setTimeout(() => {
      if (current.endedAt !== endedAt || skippedRef.current) return;
      current.endedAt = null;
      current.baseline = answerKey;
      // The answer's own read-aloud control shows this playback and pauses it.
      void playReadAloud(answerText, answerEntryKey);
    }, settleMs);
    return () => clearTimeout(timer);
  }, [
    aborted,
    answerEntryKey,
    answerKey,
    answerText,
    enabled,
    loaded,
    sessionId,
    working,
    workingElsewhere,
  ]);

  return { enabled, skipTurn, toggle };
}
