/**
 * Multi-host storage for remote access.
 *
 * Stores multiple saved hosts (relay or direct) with their SRP sessions
 * for quick reconnection without re-entering credentials.
 */

import type {
  SessionEstablishmentKind,
  StoredSession,
} from "./connection/SecureConnection";
import {
  forgetRetainedResumes,
  mutateResumeCredentials,
  scopeForHost,
} from "./rejectedResumeStorage";
import {
  SAVED_HOSTS_KEY,
  TAB_HOST_KEY,
  TAB_CREDENTIAL_OWNER_KEY,
  REMOTE_CREDENTIALS_KEY,
} from "./storageKeys";
import { generateUUID } from "./uuid";
import { resumeScopeKey, type ResumeScope } from "./rejectedResumeStorage";

/** A saved host configuration */
export interface SavedHost {
  id: string;
  displayName: string;
  mode: "relay" | "direct";

  // Relay mode fields
  relayUrl?: string;
  relayUsername?: string;

  // Direct mode fields
  wsUrl?: string;

  // Auth
  srpUsername: string;
  /**
   * Every identity that has signed in to this relay host from this browser,
   * most recent last. Lets the relay login restore the server name when the
   * browser's password manager fills only the identity.
   */
  srpUsernames?: string[];
  session?: StoredSession;
  /** Changes on password intent or explicit erasure, not resume retirement. */
  credentialRevision?: string;

  // Stable server-advertised identity, learned during auth/pairing. When
  // present, source identity resolves to `server:<id>` so it survives
  // direct/relay transport failover (see lib/sourceIdentity.ts). Not yet
  // populated by any flow.
  serverInstanceId?: string;

  // Metadata
  lastConnected?: string;
  createdAt: string;
}

/** Root storage structure */
export interface SavedHostsStorage {
  version: 1;
  hosts: SavedHost[];
}

/** Load saved hosts from localStorage */
export function loadSavedHosts(): SavedHostsStorage {
  try {
    const stored = localStorage.getItem(SAVED_HOSTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as SavedHostsStorage;
      if (parsed.version === 1 && Array.isArray(parsed.hosts)) {
        for (const host of parsed.hosts) {
          if (host.session && !sessionMatchesHost(host.session, host))
            host.session = undefined;
        }
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return { version: 1, hosts: [] };
}

/** Save the entire hosts storage */
function saveSavedHosts(data: SavedHostsStorage): void {
  try {
    localStorage.setItem(SAVED_HOSTS_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

/** Add or update a host */
export function saveHost(host: SavedHost): void {
  const data = loadSavedHosts();
  const existingIndex = data.hosts.findIndex((h) => h.id === host.id);

  if (existingIndex >= 0) {
    const existing = data.hosts[existingIndex]!;
    const replaced =
      resumeScopeKey(scopeForHost(existing)) !==
        resumeScopeKey(scopeForHost(host)) ||
      existing.session?.sessionId !== host.session?.sessionId ||
      existing.session?.sessionKey !== host.session?.sessionKey;
    data.hosts[existingIndex] = {
      ...host,
      credentialRevision: replaced
        ? generateUUID()
        : existing.credentialRevision,
    };
  } else {
    data.hosts.push(host);
  }

  saveSavedHosts(data);
}

/** Create or update a relay host and optionally attach its stored session. */
export function upsertRelayHost(params: {
  relayUrl: string;
  relayUsername: string;
  srpUsername: string;
  session?: StoredSession;
}): SavedHost {
  const existing = getHostByRelayUsername(
    params.relayUsername,
    params.relayUrl,
    params.srpUsername,
  );
  const srpUsernames = [
    ...(existing?.srpUsernames ?? [existing?.srpUsername]).filter(
      (name): name is string => !!name && name !== params.srpUsername,
    ),
    params.srpUsername,
  ];
  const host: SavedHost = existing
    ? {
        ...existing,
        relayUrl: params.relayUrl,
        srpUsername: params.srpUsername,
        srpUsernames,
        session: params.session ?? existing.session,
        lastConnected: params.session
          ? new Date().toISOString()
          : existing.lastConnected,
      }
    : {
        ...createRelayHost(params),
        srpUsernames,
        session: params.session,
        lastConnected: params.session ? new Date().toISOString() : undefined,
      };

  saveHost(host);
  return host;
}

/** Update just the session for a host (for session resumption) */
export function updateHostSession(
  id: string,
  session: StoredSession | undefined,
): void {
  const data = loadSavedHosts();
  const host = data.hosts.find((h) => h.id === id);

  if (host) {
    if (host.session?.sessionId !== session?.sessionId)
      host.credentialRevision = generateUUID();
    host.session = session;
    host.lastConnected = new Date().toISOString();
    saveSavedHosts(data);
  }
}

/** Remove only the stored resume session for a host, preserving login config. */
export function clearHostSession(id: string): void {
  const data = loadSavedHosts();
  const host = data.hosts.find((h) => h.id === id);

  if (host) {
    delete host.session;
    host.credentialRevision = generateUUID();
    saveSavedHosts(data);
  }
}

/** Remove only the stored resume session for a relay host. */
export function clearRelayHostSession(relayUsername: string): void {
  const data = loadSavedHosts();
  const host = data.hosts.find(
    (h) => h.mode === "relay" && h.relayUsername === relayUsername,
  );

  if (host) {
    delete host.session;
    host.credentialRevision = generateUUID();
    saveSavedHosts(data);
  }
}

/** Remove a host by ID */
export async function removeHost(id: string): Promise<void> {
  const target = getHostById(id);
  if (target) forgetRetainedResumes(scopeForHost(target), undefined, true);
  await mutateResumeCredentials(() => {
    const data = loadSavedHosts();
    const host = data.hosts.find((candidate) => candidate.id === id);
    if (host) {
      try {
        const raw = localStorage.getItem(REMOTE_CREDENTIALS_KEY);
        const legacy = raw ? JSON.parse(raw) : null;
        if (
          legacy &&
          legacy.username === host.srpUsername &&
          (legacy.mode === "relay" ? "relay" : "direct") === host.mode &&
          legacy.wsUrl ===
            (host.mode === "relay" ? host.relayUrl : host.wsUrl) &&
          (host.mode !== "relay" || legacy.relayUsername === host.relayUsername)
        )
          localStorage.removeItem(REMOTE_CREDENTIALS_KEY);
      } catch {
        /* Unavailable legacy storage does not block host removal. */
      }
    }
    data.hosts = data.hosts.filter((candidate) => candidate.id !== id);
    saveSavedHosts(data);
  });
}

/** Find a host by relay username */
export function getHostByRelayUsername(
  username: string,
  relayUrl?: string,
  identity?: string,
): SavedHost | undefined {
  const data = loadSavedHosts();
  if (relayUrl === undefined && identity === undefined) {
    try {
      const selected = data.hosts.find(
        (h) => h.id === sessionStorage.getItem(TAB_HOST_KEY),
      );
      if (selected?.mode === "relay" && selected.relayUsername === username)
        return selected;
    } catch {
      /* No tab preference when storage is disabled. */
    }
  }
  return data.hosts.find(
    (h) =>
      h.mode === "relay" &&
      h.relayUsername === username &&
      (relayUrl === undefined || h.relayUrl === relayUrl) &&
      (identity === undefined || h.srpUsername === identity),
  );
}

/**
 * The relay host an identity last signed in to from this browser. The owner's
 * identity is the server name itself, so that also matches a host directly.
 */
export function findRelayHostForIdentity(
  identity: string,
): SavedHost | undefined {
  const matches = loadSavedHosts().hosts.filter(
    (h) =>
      h.mode === "relay" &&
      (h.relayUsername === identity ||
        h.srpUsername === identity ||
        h.srpUsernames?.includes(identity)),
  );
  return matches.sort((a, b) =>
    (b.lastConnected ?? b.createdAt).localeCompare(
      a.lastConnected ?? a.createdAt,
    ),
  )[0];
}

/** Find a host by ID */
export function getHostById(id: string): SavedHost | undefined {
  const data = loadSavedHosts();
  return data.hosts.find((h) => h.id === id);
}

/** Find a direct host by WebSocket URL */
export function getHostByDirectWsUrl(
  wsUrl: string,
  identity?: string,
): SavedHost | undefined {
  const data = loadSavedHosts();
  return data.hosts.find(
    (h) =>
      h.mode === "direct" &&
      h.wsUrl === wsUrl &&
      (identity === undefined || h.srpUsername === identity),
  );
}

/** Create a new relay host (doesn't save yet - call saveHost to persist) */
export function createRelayHost(params: {
  relayUrl: string;
  relayUsername: string;
  srpUsername: string;
  displayName?: string;
}): SavedHost {
  return {
    id: generateUUID(),
    displayName: params.displayName ?? params.relayUsername,
    mode: "relay",
    relayUrl: params.relayUrl,
    relayUsername: params.relayUsername,
    srpUsername: params.srpUsername,
    createdAt: new Date().toISOString(),
  };
}

/** Create a new direct host (doesn't save yet - call saveHost to persist) */
export function createDirectHost(params: {
  wsUrl: string;
  srpUsername: string;
  displayName?: string;
}): SavedHost {
  // Generate a display name from URL if not provided
  let defaultName = params.srpUsername;
  try {
    const url = new URL(params.wsUrl);
    defaultName = url.hostname;
  } catch {
    // Keep srpUsername as default
  }

  return {
    id: generateUUID(),
    displayName: params.displayName ?? defaultName,
    mode: "direct",
    wsUrl: params.wsUrl,
    srpUsername: params.srpUsername,
    createdAt: new Date().toISOString(),
  };
}

/** A handshake owns this immutable record, never the UI's mutable current host. */
export interface HostCredentialAttempt {
  hostId: string;
  scope: ResumeScope;
  revision: string;
  sessionId?: string;
  previousSessionId?: string;
}

function sessionMatchesHost(session: StoredSession, host: SavedHost): boolean {
  return (
    session.username === host.srpUsername &&
    (host.mode === "relay" || session.wsUrl === host.wsUrl)
  );
}

export function hostForScope(scope: ResumeScope): SavedHost | undefined {
  return loadSavedHosts().hosts.find(
    (host) => resumeScopeKey(scopeForHost(host)) === resumeScopeKey(scope),
  );
}

/** Call under mutateResumeCredentials; capture before any asynchronous acquisition. */
export function beginHostCredentialAttempt(
  scope: ResumeScope,
  session?: StoredSession,
): HostCredentialAttempt {
  const data = loadSavedHosts();
  let host = data.hosts.find(
    (candidate) =>
      resumeScopeKey(scopeForHost(candidate)) === resumeScopeKey(scope),
  );
  if (!host) {
    if (session) throw new Error("Saved credential was removed or replaced");
    host =
      scope.mode === "relay"
        ? createRelayHost({
            relayUrl: scope.endpoint,
            relayUsername: scope.relayUsername!,
            srpUsername: scope.identity,
          })
        : createDirectHost({
            wsUrl: scope.endpoint,
            srpUsername: scope.identity,
          });
    data.hosts.push(host);
  }
  if (
    session &&
    (!sessionMatchesHost(session, host) ||
      host.session?.sessionId !== session.sessionId ||
      host.session.sessionKey !== session.sessionKey)
  )
    throw new Error("Saved credential was removed or replaced");
  if (!session || !host.credentialRevision)
    host.credentialRevision = generateUUID();
  saveSavedHosts(data);
  return {
    hostId: host.id,
    scope: { ...scope },
    revision: host.credentialRevision,
    sessionId: session?.sessionId,
    previousSessionId: host.session?.sessionId,
  };
}

export function isHostCredentialAttemptCurrent(
  attempt: HostCredentialAttempt,
): boolean {
  const host = getHostById(attempt.hostId);
  return (
    !!host &&
    host.credentialRevision === attempt.revision &&
    resumeScopeKey(scopeForHost(host)) === resumeScopeKey(attempt.scope) &&
    (attempt.sessionId === undefined ||
      host.session?.sessionId === attempt.sessionId)
  );
}

export function clearTabCredentialOwner(): void {
  try {
    sessionStorage.removeItem(TAB_CREDENTIAL_OWNER_KEY);
  } catch {
    /* Optional tab storage. */
  }
}

/** Compare-and-set prevents an old tab from resurrecting erased or newer credentials. */
export function commitHostCredential(
  attempt: HostCredentialAttempt,
  session: StoredSession,
  kind: SessionEstablishmentKind = attempt.sessionId === undefined
    ? "password"
    : "resume",
): SavedHost | undefined {
  const data = loadSavedHosts();
  const host = data.hosts.find((candidate) => candidate.id === attempt.hostId);
  if (
    !host ||
    host.credentialRevision !== attempt.revision ||
    resumeScopeKey(scopeForHost(host)) !== resumeScopeKey(attempt.scope) ||
    !sessionMatchesHost(session, host) ||
    (session.sessionId === host.session?.sessionId &&
      (session.resumeProtocolVersion ?? 1) <
        (host.session?.resumeProtocolVersion ?? 1)) ||
    (kind === "resume" &&
      (host.session?.sessionId !== session.sessionId ||
        (attempt.sessionId !== undefined &&
          session.sessionId !== attempt.sessionId)))
  )
    return undefined;
  host.session = session;
  host.lastConnected = new Date().toISOString();
  saveSavedHosts(data);
  return host;
}

/** Public ownership metadata only; no key is copied into tab storage. */
export function bindTabCredential(attempt: HostCredentialAttempt): void {
  try {
    sessionStorage.setItem(TAB_CREDENTIAL_OWNER_KEY, JSON.stringify(attempt));
  } catch {
    /* Storage may be disabled. */
  }
}

/** Logout erases only the credential generation owned by this tab. */
export async function eraseTabCredential(): Promise<void> {
  let attempt: HostCredentialAttempt | undefined;
  try {
    attempt =
      JSON.parse(sessionStorage.getItem(TAB_CREDENTIAL_OWNER_KEY) ?? "null") ??
      undefined;
  } catch {
    return;
  }
  if (!attempt) return;
  const owner = attempt;
  await mutateResumeCredentials(() => {
    const host = getHostById(owner.hostId);
    if (
      !host ||
      host.credentialRevision !== owner.revision ||
      resumeScopeKey(scopeForHost(host)) !== resumeScopeKey(owner.scope)
    )
      return;
    clearHostSession(host.id);
    try {
      const raw = localStorage.getItem(REMOTE_CREDENTIALS_KEY);
      const legacy = raw ? JSON.parse(raw) : null;
      if (
        legacy &&
        legacy.session?.sessionId === host.session?.sessionId &&
        legacy.username === host.srpUsername &&
        legacy.wsUrl === owner.scope.endpoint &&
        legacy.relayUsername === owner.scope.relayUsername
      ) {
        delete legacy.session;
        localStorage.setItem(REMOTE_CREDENTIALS_KEY, JSON.stringify(legacy));
      }
    } catch {
      /* Unavailable compatibility storage does not block scoped erasure. */
    }
  });
}
