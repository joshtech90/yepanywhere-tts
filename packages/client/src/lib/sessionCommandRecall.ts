import { useCallback, useState } from "react";
import {
  COMMAND_RECALL_ID_PREFIX,
  type ComposerTurnRecallEntry,
  createCommandRecallEntry,
} from "./composerTurnRecall";
import { getLocalStorage } from "./localStorageValue";

/**
 * Accepted YA commands (`/clear N`, `/fork N`, `/clearloop …`) never become
 * transcript turns, so the composer recall drawer remembers them here:
 * browser-local, per session, newest first. See topics/session-rewind.md
 * § Composer recall.
 *
 * All sessions share one key holding the most recently used sessions, so the
 * history is bounded however many sessions ever ran a command.
 */
export const COMMAND_RECALL_STORAGE_KEY = "ya:command-recall";
/** Sessions whose command history is kept; the least recently used drop. */
export const MAX_COMMAND_RECALL_SESSIONS = 30;
/** Commands kept per session. */
export const MAX_COMMAND_RECALL_ENTRIES = 50;
/** Earlier releases wrote one never-evicted key per session. */
const LEGACY_KEY_PREFIX = `${COMMAND_RECALL_STORAGE_KEY}:`;

interface StoredCommand {
  id: string;
  text: string;
}

interface StoredSession {
  sessionId: string;
  commands: StoredCommand[];
}

function parseCommands(value: unknown): StoredCommand[] {
  if (!Array.isArray(value)) return [];
  const commands: StoredCommand[] = [];
  for (const item of value) {
    if (typeof item?.id === "string" && typeof item?.text === "string") {
      commands.push({ id: item.id, text: item.text });
    }
  }
  return commands;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseSessions(raw: string | null): StoredSession[] {
  const value = parseJson(raw) as { sessions?: unknown } | undefined;
  if (!Array.isArray(value?.sessions)) return [];
  const sessions: StoredSession[] = [];
  for (const item of value.sessions) {
    if (typeof item?.sessionId !== "string") continue;
    const commands = parseCommands(item.commands);
    if (commands.length > 0) {
      sessions.push({ sessionId: item.sessionId, commands });
    }
  }
  return sessions;
}

/** Recording time carried in a command entry's id; 0 when absent. */
function recordedAt(command: StoredCommand | undefined): number {
  if (!command?.id.startsWith(COMMAND_RECALL_ID_PREFIX)) return 0;
  const at = Number(command.id.slice(COMMAND_RECALL_ID_PREFIX.length));
  return Number.isFinite(at) ? at : 0;
}

/**
 * The stored sessions, with any legacy per-session keys folded in behind them
 * (newest command first) and removed once the shared key holds their history.
 */
function loadSessions(storage: Storage): StoredSession[] {
  let sessions: StoredSession[];
  const legacy: { key: string; session: StoredSession }[] = [];
  try {
    sessions = parseSessions(storage.getItem(COMMAND_RECALL_STORAGE_KEY));
    for (let position = 0; position < storage.length; position += 1) {
      const key = storage.key(position);
      if (!key?.startsWith(LEGACY_KEY_PREFIX)) continue;
      legacy.push({
        key,
        session: {
          sessionId: key.slice(LEGACY_KEY_PREFIX.length),
          commands: parseCommands(parseJson(storage.getItem(key))),
        },
      });
    }
  } catch {
    return [];
  }
  if (legacy.length === 0) return sessions;
  const known = new Set(sessions.map((session) => session.sessionId));
  const adopted = legacy
    .map(({ session }) => session)
    .filter(
      (session) => session.commands.length > 0 && !known.has(session.sessionId),
    )
    .sort((a, b) => recordedAt(b.commands[0]) - recordedAt(a.commands[0]));
  const merged = [...sessions, ...adopted].slice(
    0,
    MAX_COMMAND_RECALL_SESSIONS,
  );
  if (writeSessions(storage, merged)) {
    for (const { key } of legacy) {
      try {
        storage.removeItem(key);
      } catch {
        // A key left behind is folded in again on the next load.
      }
    }
  }
  return merged;
}

function writeSessions(storage: Storage, sessions: StoredSession[]): boolean {
  try {
    if (sessions.length === 0) {
      storage.removeItem(COMMAND_RECALL_STORAGE_KEY);
    } else {
      storage.setItem(COMMAND_RECALL_STORAGE_KEY, JSON.stringify({ sessions }));
    }
    return true;
  } catch {
    return false;
  }
}

function toEntries(
  commands: readonly StoredCommand[],
): ComposerTurnRecallEntry[] {
  return commands.map((command) => ({
    ...createCommandRecallEntry(command.text),
    id: command.id,
  }));
}

/** One session's recalled commands, newest first. */
export function readSessionCommandRecall(
  sessionId: string,
): ComposerTurnRecallEntry[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  const session = loadSessions(storage).find(
    (candidate) => candidate.sessionId === sessionId,
  );
  return toEntries(session?.commands ?? []);
}

/**
 * Record an accepted command at the head of its session's history and make
 * that session the most recently used. Reads what is stored rather than a
 * caller's copy, so another tab's commands survive. Returns the session's
 * resulting entries, which still serve this tab if storage refuses the write.
 */
export function recordSessionCommandRecall(
  sessionId: string,
  text: string,
  at = Date.now(),
): ComposerTurnRecallEntry[] {
  const storage = getLocalStorage();
  const sessions = storage ? loadSessions(storage) : [];
  const previous =
    sessions.find((session) => session.sessionId === sessionId)?.commands ?? [];
  const { id } = createCommandRecallEntry(text, at);
  const commands = [
    { id, text },
    ...previous.filter((command) => command.text !== text),
  ].slice(0, MAX_COMMAND_RECALL_ENTRIES);
  if (storage) {
    writeSessions(
      storage,
      [
        { sessionId, commands },
        ...sessions.filter((session) => session.sessionId !== sessionId),
      ].slice(0, MAX_COMMAND_RECALL_SESSIONS),
    );
  }
  return toEntries(commands);
}

/** A session page's recalled commands and the recorder for new ones. */
export function useSessionCommandRecall(sessionId: string): {
  entries: ComposerTurnRecallEntry[];
  record: (text: string) => void;
} {
  const [state, setState] = useState(() => ({
    sessionId,
    entries: readSessionCommandRecall(sessionId),
  }));
  let current = state;
  if (state.sessionId !== sessionId) {
    current = { sessionId, entries: readSessionCommandRecall(sessionId) };
    setState(current);
  }
  const record = useCallback(
    (text: string) => {
      setState({
        sessionId,
        entries: recordSessionCommandRecall(sessionId, text),
      });
    },
    [sessionId],
  );
  return { entries: current.entries, record };
}
