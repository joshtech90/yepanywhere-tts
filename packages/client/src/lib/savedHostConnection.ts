import {
  SecureConnection,
  type RelaySocketFactory,
  type SessionEstablishmentKind,
} from "./connection/SecureConnection";
import { openRelayClientSocket } from "./connection/RelayClientSocket";
import { getResumeError } from "./connection/resumeErrors";
import { scopeForHost, mutateResumeCredentials } from "./rejectedResumeStorage";
import {
  beginHostCredentialAttempt,
  commitHostCredential,
  isHostCredentialAttemptCurrent,
  type HostCredentialAttempt,
  type SavedHost,
} from "./hostStorage";
import type { StoredSession } from "./connection/SecureConnection";

export class MultiHostSignInRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultiHostSignInRequiredError";
  }
}

export function isSavedHostSignInRequiredError(error: unknown): boolean {
  if (error instanceof MultiHostSignInRequiredError) return true;
  const resume = getResumeError(error);
  if (resume)
    return resume.kind === "rejected" || resume.kind === "incompatible";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("authentication") ||
    normalized.includes("invalid_identity") ||
    normalized.includes("resume_incompatible") ||
    normalized.includes("session invalid") ||
    normalized.includes("session resume") ||
    normalized.includes("unauthorized")
  );
}

/**
 * How a connection claims its host's saved credential and records a refreshed
 * one. Documents use the saved-host records in `localStorage`; the Chrome
 * extension's background worker, which has none, supplies its own.
 */
export interface SavedHostCredentials {
  begin(
    host: SavedHost,
    session: StoredSession,
  ): Promise<HostCredentialAttempt>;
  isCurrent(attempt: HostCredentialAttempt): boolean;
  commit(
    attempt: HostCredentialAttempt,
    session: StoredSession,
    kind: SessionEstablishmentKind,
  ): Promise<void>;
}

export const documentSavedHostCredentials: SavedHostCredentials = {
  begin: (host, session) =>
    mutateResumeCredentials(() =>
      beginHostCredentialAttempt(scopeForHost(host), session),
    ),
  isCurrent: isHostCredentialAttemptCurrent,
  commit: (attempt, session, kind) =>
    mutateResumeCredentials(() => {
      commitHostCredential(attempt, session, kind);
    }),
};

export async function connectSavedHost(
  host: SavedHost,
  signal: AbortSignal,
  relaySocketFactory?: RelaySocketFactory,
  onDisconnect?: (error: Error) => void,
  credentials: SavedHostCredentials = documentSavedHostCredentials,
): Promise<SecureConnection> {
  signal.throwIfAborted();
  const session = host.session;
  if (!session) {
    throw new MultiHostSignInRequiredError("A saved session is required");
  }

  signal.throwIfAborted();
  const owner = await credentials.begin(host, session);
  signal.throwIfAborted();

  const callbacks = {
    onDisconnect,
    isAttemptCurrent: () => !signal.aborted && credentials.isCurrent(owner),
    onSessionEstablished: async (
      nextSession: typeof session,
      kind: SessionEstablishmentKind,
    ) => {
      if (!signal.aborted) await credentials.commit(owner, nextSession, kind);
    },
  };

  if (host.mode === "direct") {
    if (!host.wsUrl) {
      throw new MultiHostSignInRequiredError(
        "The saved direct host has no WebSocket URL",
      );
    }
    const connection = SecureConnection.forResumeOnly(session, callbacks);
    const abort = () => connection.close();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await connection.fetch("/auth/status");
      signal.throwIfAborted();
      return connection;
    } catch (error) {
      connection.close();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  if (!host.relayUrl || !host.relayUsername) {
    throw new MultiHostSignInRequiredError(
      "The saved relay host is incomplete",
    );
  }
  const openSocket = relaySocketFactory ?? openRelayClientSocket;
  const ws = await openSocket({
    relayUrl: host.relayUrl,
    relayUsername: host.relayUsername,
    signal,
  });
  if (signal.aborted) {
    ws.close();
    signal.throwIfAborted();
  }
  const abort = () => ws.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const connection = await SecureConnection.forResumeOnlyWithSocket(
      ws,
      session,
      callbacks,
      {
        relayUrl: host.relayUrl,
        relayUsername: host.relayUsername,
        openSocket: relaySocketFactory,
      },
    );
    await connection.fetch("/auth/status");
    signal.throwIfAborted();
    return connection;
  } catch (error) {
    ws.close();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
