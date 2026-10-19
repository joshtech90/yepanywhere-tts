/**
 * RemoteConnectionContext - Provides SecureConnection for remote client.
 *
 * This context manages the SecureConnection lifecycle and provides it to
 * the app. Unlike the regular client, which uses a localhost source transport
 * by default, the remote client ONLY uses SecureConnection.
 *
 * Supports two connection modes:
 * - Direct: Connect via WebSocket URL + SRP auth
 * - Relay: Connect via relay server + relay username + SRP auth
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useLocation } from "react-router-dom";
import type { ClientSummarySourceKey } from "../lib/clientSummaryStore";
import {
  SecureConnection,
  type StoredSession,
  type SessionEstablishmentKind,
} from "../lib/connection/SecureConnection";
import {
  mutateResumeCredentials,
  resumeScopeKey,
  type ResumeScope,
} from "../lib/rejectedResumeStorage";
import {
  advanceLegacyCredentialMirror,
  type LegacyCredentialOwner,
} from "../lib/legacyCredentialMirror";
import { openRelayClientSocket } from "../lib/connection/RelayClientSocket";
import type { Connection } from "../lib/connection/types";
import { SecureSourceTransport } from "../lib/transport";
import {
  getHostByDirectWsUrl,
  getHostById,
  getHostByRelayUsername,
  bindTabCredential,
  clearTabCredentialOwner,
  isHostCredentialAttemptCurrent,
  beginHostCredentialAttempt,
  commitHostCredential,
  hostForScope,
  createDirectHost,
  saveHost,
  type SavedHost,
  upsertRelayHost,
} from "../lib/hostStorage";
import {
  resolveSourceKeyForUnsavedScope,
  resolveSourceKeyForSavedHost,
} from "../lib/sourceIdentity";
import { getSourceRuntimeRegistry } from "../lib/sourceRuntime";
import { primeRemoteRoute } from "../lib/remoteRouteBootstrap";
import {
  REMOTE_CREDENTIALS_KEY as STORAGE_KEY,
  TAB_HOST_KEY,
  LAST_HOST_KEY,
} from "../lib/storageKeys";
import { consumeSwitchHostReload } from "../lib/switchHostReload";

import { getResumeError } from "../lib/connection/resumeErrors";
import { useResumeRecovery } from "../hooks/useResumeRecovery";
import {
  canRetryResume,
  categorizeResumeError,
  type AutoResumeErrorReason,
} from "../lib/connection/remoteErrors";
export type { AutoResumeErrorReason } from "../lib/connection/remoteErrors";

/** Stored credentials for auto-reconnect */
interface StoredCredentials {
  wsUrl: string;
  username: string;
  /** Session data for resumption (only stored if rememberMe was enabled) */
  session?: StoredSession;
  /** Connection mode: "direct" or "relay" */
  mode?: "direct" | "relay";
  /** Relay username (only for relay mode) */
  relayUsername?: string;
}

/** Relay connection status for UI feedback */
export type RelayConnectionStatus =
  | "idle"
  | "connecting_relay"
  | "waiting_server"
  | "authenticating"
  | "error";

/** Structured error from auto-resume failure */
export interface AutoResumeError {
  reason: AutoResumeErrorReason;
  mode: "relay" | "direct";
  /** Relay username (relay mode only) */
  relayUsername?: string;
  /** Server URL (direct mode) or relay URL (relay mode) */
  serverUrl?: string;
  /** Original error message */
  message: string;
}

/** Options for connecting via relay */
export interface ConnectViaRelayOptions {
  relayUrl: string;
  relayUsername: string;
  srpUsername: string;
  srpPassword: string;
  rememberMe?: boolean;
  onStatusChange?: (status: RelayConnectionStatus) => void;
  /** Optional session for resumption (if provided, srpPassword is ignored) */
  session?: StoredSession;
}

export interface RemoteConnectionState {
  /** Installed native shell supplies its source without web credential storage. */
  nativeSource?: {
    sourceKey: ClientSummarySourceKey;
    registration: import("../lib/sourceRuntime").SourceTransportRegistration;
  };
  switchHost?: () => void;
  /** The active connection (null if not connected) */
  connection: Connection | null;
  /** Exact runtime attached to the active browser connection. */
  activeSourceKey?: ClientSummarySourceKey | null;
  activeAuthenticationScope?: ResumeScope | null;
  /** Whether a connection attempt is in progress */
  isConnecting: boolean;
  /** Whether auto-resume is being attempted (subset of isConnecting) */
  isAutoResuming: boolean;
  /** Error from last connection attempt */
  error: string | null;
  /** Structured error from auto-resume failure (for showing modal) */
  autoResumeError: AutoResumeError | null;
  /** Current host ID from hostStorage (for multi-host tracking) */
  currentHostId: string | null;
  /** Relay username of the active connection, including unsaved hosts */
  currentRelayUsername: string | null;
  /** Live relay URL, including connections that are not remembered. */
  currentRelayUrl: string | null;
  /** Direct WebSocket URL for direct connections without a saved host */
  currentDirectUrl: string | null;
  /** Set the current host ID (called by RelayConnectionGate after connect) */
  setCurrentHostId: (hostId: string | null) => void;
  /** Whether user intentionally disconnected (prevents auto-redirect) */
  isIntentionalDisconnect: boolean;
  /** Connect to server with credentials (direct mode) */
  connect: (
    wsUrl: string,
    username: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<void>;
  /** Connect via relay server */
  connectViaRelay: (options: ConnectViaRelayOptions) => Promise<void>;
  /** Disconnect this source. Set isIntentional=false for programmatic host switches. */
  disconnect: (isIntentional?: boolean) => void;
  /** Clear auto-resume error (e.g., user chose to go to login) */
  clearAutoResumeError: () => void;
  /** Retry auto-resume after failure */
  retryAutoResume: () => void;
  /** Stored server URL (for pre-filling form) */
  storedUrl: string | null;
  /** Stored username (for pre-filling form) */
  storedUsername: string | null;
  /** Whether there's a stored session that can be resumed */
  hasStoredSession: boolean;
  /** Try to resume a stored session (requires password for fallback) */
  resumeSession: (password: string) => Promise<void>;
}

export const RemoteConnectionContext =
  createContext<RemoteConnectionState | null>(null);

function credentialsForHost(host: SavedHost): StoredCredentials {
  return {
    wsUrl: (host.mode === "relay" ? host.relayUrl : host.wsUrl) ?? "",
    username: host.srpUsername,
    mode: host.mode,
    relayUsername: host.relayUsername,
    session: host.session,
  };
}
function credentialScope(stored: StoredCredentials): ResumeScope {
  return {
    mode: stored.mode === "relay" ? "relay" : "direct",
    endpoint: stored.wsUrl,
    identity: stored.username,
    relayUsername: stored.mode === "relay" ? stored.relayUsername : undefined,
  };
}

/** URL selection wins; credentials live in saved hosts, never the last-host preference. */
function loadStoredCredentials(pathname?: string): StoredCredentials | null {
  try {
    const route = pathname?.match(/\/-\/relay\/([^/]+)/);
    if (route) {
      const host = getHostByRelayUsername(decodeURIComponent(route[1]!));
      if (host) return credentialsForHost(host);
    }
    const selected = sessionStorage.getItem(TAB_HOST_KEY);
    if (!route && selected) {
      const host = getHostById(selected);
      return host ? credentialsForHost(host) : null;
    }
    const last = localStorage.getItem(LAST_HOST_KEY);
    if (!route && last) {
      const host = getHostById(last);
      return host ? credentialsForHost(host) : null;
    }
    // One-time compatibility import. Never combine a legacy endpoint with
    // another host's session, including when cached clients keep writing it.
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredCredentials;
    if (
      !stored.wsUrl ||
      !stored.username ||
      (route &&
        (stored.mode !== "relay" ||
          stored.relayUsername !== decodeURIComponent(route[1]!)))
    )
      return null;
    const host = hostForScope(credentialScope(stored));
    if (host) return credentialsForHost(host);
    if (
      stored.session?.username !== stored.username ||
      (stored.mode !== "relay" && stored.session.wsUrl !== stored.wsUrl) ||
      (stored.mode === "relay" && !stored.relayUsername)
    )
      return null;
    return stored;
  } catch {
    return null;
  }
}

/** Legacy mirror is for cached clients; current readers use the host record. */
function rememberHost(host: SavedHost): void {
  try {
    sessionStorage.setItem(TAB_HOST_KEY, host.id);
    localStorage.setItem(LAST_HOST_KEY, host.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentialsForHost(host)));
  } catch {
    /* Optional persistence must not block password authentication. */
  }
}
function clearTabHostSelection(): void {
  sessionStorage.removeItem(TAB_HOST_KEY);
}

/** Attempts rebuild equal scopes; keep one object so dependents see real changes only. */
function retainScope(
  current: ResumeScope | null,
  next: ResumeScope,
): ResumeScope {
  return current && resumeScopeKey(current) === resumeScopeKey(next)
    ? current
    : next;
}

interface Props {
  children: ReactNode;
}

class ConnectionAttemptSupersededError extends Error {
  constructor() {
    super("Connection attempt superseded");
    this.name = "ConnectionAttemptSupersededError";
  }
}

function getSecureSourceTransport(
  sourceKey: ClientSummarySourceKey,
): SecureSourceTransport {
  const transport = getSourceRuntimeRegistry().registerSourceTransport(
    sourceKey,
    { kind: "secure" },
  );
  if (transport instanceof SecureSourceTransport) return transport;
  throw new Error(
    "Remote source transport registration did not create secure transport",
  );
}

export function RemoteConnectionProvider({ children }: Props) {
  // Load stored credentials synchronously to determine initial state
  const location = useLocation();
  const initialStored = loadStoredCredentials(location.pathname);
  const [switchHostReload] = useState(() => consumeSwitchHostReload());
  const [explicitLogin] = useState(() =>
    /\/login\/(relay|direct)\/?$/.test(location.pathname),
  );

  const [connection, setConnection] = useState<SecureConnection | null>(null);
  const [activeSourceKey, setActiveSourceKey] =
    useState<ClientSummarySourceKey | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  // Initialize isAutoResuming to true if we have a stored session to resume
  // This prevents a flash of the login form before auto-resume starts
  const [isAutoResuming, setIsAutoResuming] = useState(
    () => !switchHostReload && !explicitLogin && !!initialStored?.session,
  );
  const [error, setError] = useState<string | null>(null);
  const [autoResumeError, setAutoResumeError] =
    useState<AutoResumeError | null>(null);
  // Track current host ID for multi-host support
  const [currentHostId, setCurrentHostIdState] = useState<string | null>(null);
  // Keep the live relay identity separate because "Remember me" may leave the
  // active connection without a persisted SavedHost record.
  const [currentRelayUsername, setCurrentRelayUsername] = useState<
    string | null
  >(() =>
    initialStored?.mode === "relay"
      ? (initialStored.relayUsername ?? null)
      : null,
  );
  const [currentRelayUrl, setCurrentRelayUrl] = useState<string | null>(() =>
    initialStored?.mode === "relay" ? initialStored.wsUrl : null,
  );
  const [currentDirectUrl, setCurrentDirectUrlState] = useState<string | null>(
    null,
  );
  // Tab selection is UI state; credential callbacks use their captured owner.
  const currentHostIdRef = useRef<string | null>(null);
  const setCurrentHostId = useCallback((hostId: string | null) => {
    currentHostIdRef.current = hostId;
    setCurrentHostIdState(hostId);
  }, []);
  const currentDirectUrlRef = useRef<string | null>(null);
  const setCurrentDirectUrl = useCallback((url: string | null) => {
    currentDirectUrlRef.current = url;
    setCurrentDirectUrlState(url);
  }, []);
  // Track if we've attempted auto-resume (to prevent repeated attempts)
  const [autoResumeAttempted, setAutoResumeAttempted] = useState(
    () => switchHostReload || explicitLogin,
  );
  // Track intentional disconnect (to prevent auto-redirect back to host after Switch Host)
  const [isIntentionalDisconnect, setIsIntentionalDisconnect] =
    useState(switchHostReload);
  const activeSecureTransportRef = useRef<SecureSourceTransport | null>(null);
  const activeTransportStatusUnsubscribeRef = useRef<(() => void) | null>(null);
  const connectionRef = useRef<SecureConnection | null>(connection);
  connectionRef.current = connection;
  const connectionAttemptRef = useRef(0);
  const beginConnectionAttempt = useCallback(() => {
    clearTabCredentialOwner();
    setActiveSourceKey(null);
    connectionAttemptRef.current += 1;
    return connectionAttemptRef.current;
  }, []);
  const isCurrentConnectionAttempt = useCallback(
    (attempt: number) => connectionAttemptRef.current === attempt,
    [],
  );

  // Keep stored credentials in ref for updates during the component lifecycle
  const storedRef = useRef(initialStored);
  storedRef.current = loadStoredCredentials(location.pathname);

  const clearTransportStatusSubscription = useCallback(() => {
    activeTransportStatusUnsubscribeRef.current?.();
    activeTransportStatusUnsubscribeRef.current = null;
  }, []);

  const activeScopeRef = useRef<ResumeScope | null>(null);

  const handleTransportDisconnected = useCallback(
    (error: Error, scope: ResumeScope | null) => {
      console.log(
        "[RemoteConnection] Source transport disconnected:",
        error.message,
      );
      connectionRef.current = null;
      setConnection(null);
      const reason = categorizeResumeError(error);
      const isRelay = scope?.mode === "relay";
      setAutoResumeError({
        reason,
        mode: isRelay ? "relay" : "direct",
        relayUsername: isRelay ? scope?.relayUsername : undefined,
        serverUrl: scope?.endpoint,
        message: getResumeError(error)?.message ?? error.message,
      });
    },
    [],
  );

  const subscribeToTransportStatus = useCallback(
    (transport: SecureSourceTransport, conn: SecureConnection) => {
      const scope = activeScopeRef.current;
      clearTransportStatusSubscription();

      const handleDisconnectedSnapshot = () => {
        if (
          activeSecureTransportRef.current !== transport ||
          connectionRef.current !== conn
        ) {
          return;
        }
        clearTransportStatusSubscription();
        const latestSnapshot = transport.status.getSnapshot();
        const message =
          latestSnapshot.channels.find(
            (channel) => channel.name === "secure-websocket",
          )?.lastError ?? "Connection disconnected";
        handleTransportDisconnected(
          transport.failure ?? new Error(message),
          scope,
        );
      };

      const syncStatus = () => {
        if (
          activeSecureTransportRef.current !== transport ||
          connectionRef.current !== conn
        ) {
          return;
        }

        const snapshot = transport.status.getSnapshot();
        if (snapshot.state === "ready") {
          setError(null);
          setAutoResumeError(null);
          return;
        }
        if (snapshot.state !== "disconnected") return;

        if (
          snapshot.channels.some(
            (channel) =>
              channel.name === "secure-websocket" && channel.lastError,
          )
        ) {
          handleDisconnectedSnapshot();
          return;
        }

        // ConnectionManager emits stateChange("disconnected") before
        // reconnectFailed, which is where the transport records lastError.
        // Let that paired event land so auto-resume errors keep their cause.
        queueMicrotask(handleDisconnectedSnapshot);
      };

      activeTransportStatusUnsubscribeRef.current =
        transport.status.subscribe(syncStatus);
      syncStatus();
    },
    [clearTransportStatusSubscription, handleTransportDisconnected],
  );

  const attachConnectionTransport = useCallback(
    (conn: SecureConnection) => {
      clearTransportStatusSubscription();
      const scope = activeScopeRef.current;
      if (!scope) throw new Error("Connection has no authentication scope");
      const host = currentHostIdRef.current
        ? getHostById(currentHostIdRef.current)
        : undefined;
      const sourceKey = host
        ? resolveSourceKeyForSavedHost(host)
        : resolveSourceKeyForUnsavedScope(scope);
      const transport = getSecureSourceTransport(sourceKey);
      if (
        activeSecureTransportRef.current &&
        activeSecureTransportRef.current !== transport
      ) {
        activeSecureTransportRef.current.detach();
      }
      transport.attach(conn);
      activeSecureTransportRef.current = transport;
      void primeRemoteRoute(
        sourceKey,
        transport,
        window.location,
        import.meta.env.BASE_URL,
      );
      return { transport, sourceKey };
    },
    [clearTransportStatusSubscription],
  );

  const publishConnection = useCallback(
    (conn: SecureConnection) => {
      const { transport, sourceKey } = attachConnectionTransport(conn);
      setActiveSourceKey(sourceKey);
      connectionRef.current = conn;
      setError(null);
      setAutoResumeError(null);
      setConnection(conn);
      subscribeToTransportStatus(transport, conn);
    },
    [attachConnectionTransport, subscribeToTransportStatus],
  );

  const detachTransport = useCallback(() => {
    clearTransportStatusSubscription();
    const transport = activeSecureTransportRef.current;
    activeSecureTransportRef.current = null;
    transport?.detach();
  }, [clearTransportStatusSubscription]);

  const captureCredential = useCallback(
    async (attempt: number, scope: ResumeScope, session?: StoredSession) => {
      return mutateResumeCredentials(() => {
        if (!isCurrentConnectionAttempt(attempt))
          throw new ConnectionAttemptSupersededError();
        const owner = beginHostCredentialAttempt(scope, session);
        activeScopeRef.current = retainScope(
          activeScopeRef.current,
          owner.scope,
        );
        setCurrentHostId(owner.hostId);
        const host = getHostById(owner.hostId);
        if (host) rememberHost(host);
        bindTabCredential(owner);
        return { credential: owner, mirrorSessionId: owner.previousSessionId };
      });
    },
    [isCurrentConnectionAttempt, setCurrentHostId],
  );

  const handleSessionEstablished = useCallback(
    (
      attempt: number,
      owner: LegacyCredentialOwner,
      session: StoredSession,
      kind: SessionEstablishmentKind,
    ) => {
      if (!isCurrentConnectionAttempt(attempt)) return;
      return mutateResumeCredentials(() => {
        if (!isCurrentConnectionAttempt(attempt)) return;
        if (commitHostCredential(owner.credential, session, kind))
          advanceLegacyCredentialMirror(owner, session, kind);
      });
    },
    [isCurrentConnectionAttempt],
  );

  // Callback for when connection is lost unexpectedly. The attached
  // SourceTransport manager observes the same close before this callback fires,
  // so React state is cleared from the transport status listener only after
  // reconnect is exhausted or a non-retryable error disconnects the source.
  const handleDisconnect = useCallback((error: Error) => {
    console.log("[RemoteConnection] Connection lost:", error.message);
  }, []);

  const connect = useCallback(
    async (
      wsUrl: string,
      username: string,
      password: string,
      rememberMe = false,
    ) => {
      const attempt = beginConnectionAttempt();
      setIsConnecting(true);
      setError(null);
      setIsIntentionalDisconnect(false);
      setCurrentRelayUsername(null);
      setCurrentRelayUrl(null);
      setCurrentDirectUrl(wsUrl);
      activeScopeRef.current = retainScope(activeScopeRef.current, {
        mode: "direct",
        endpoint: wsUrl,
        identity: username,
      });

      try {
        const savedHost = getHostByDirectWsUrl(wsUrl, username);
        setCurrentHostId(savedHost?.id ?? null);
        const savedSession =
          !password && savedHost?.srpUsername === username
            ? savedHost.session
            : undefined;
        const owner = rememberMe
          ? await captureCredential(
              attempt,
              { mode: "direct", endpoint: wsUrl, identity: username },
              savedSession,
            )
          : undefined;

        // Create and authenticate connection
        const callbacks = {
          isAttemptCurrent: () =>
            isCurrentConnectionAttempt(attempt) &&
            (!owner || isHostCredentialAttemptCurrent(owner.credential)),
          onSessionEstablished: rememberMe
            ? (session: StoredSession, kind: SessionEstablishmentKind) =>
                handleSessionEstablished(attempt, owner!, session, kind)
            : undefined,
          onDisconnect: handleDisconnect,
        };
        const conn = savedSession
          ? SecureConnection.forResumeOnly(savedSession, callbacks)
          : new SecureConnection(wsUrl, username, password, callbacks);

        // Test the connection by making a simple request
        // This triggers the SRP handshake and verifies auth
        await conn.fetch("/auth/status");
        if (!isCurrentConnectionAttempt(attempt)) {
          conn.close();
          throw new ConnectionAttemptSupersededError();
        }

        // Attach the transport before setConnection so children rendered by
        // the connected app can route API calls through the source runtime.
        publishConnection(conn);
      } catch (err) {
        if (isCurrentConnectionAttempt(attempt)) {
          const message =
            err instanceof Error ? err.message : "Connection failed";
          setError(message);
          setCurrentDirectUrl(null);
        }
        throw err;
      } finally {
        if (isCurrentConnectionAttempt(attempt)) {
          setIsConnecting(false);
        }
      }
    },
    [
      beginConnectionAttempt,
      captureCredential,
      handleSessionEstablished,
      handleDisconnect,
      isCurrentConnectionAttempt,
      publishConnection,
      setCurrentDirectUrl,
      setCurrentHostId,
    ],
  );

  const resumeSession = useCallback(
    async (password: string) => {
      const stored = storedRef.current;
      if (!stored?.session) throw new Error("No stored session to resume");
      // Explicit password entry creates a fresh login, rather than retaining
      // a reservation across rejection and password fallback of an old session.
      await connect(stored.wsUrl, stored.username, password, true);
    },
    [connect],
  );

  const connectViaRelay = useCallback(
    async (options: ConnectViaRelayOptions) => {
      const {
        relayUrl,
        relayUsername,
        srpUsername,
        srpPassword,
        rememberMe = false,
        onStatusChange,
        session,
      } = options;
      const attempt = beginConnectionAttempt();

      setIsConnecting(true);
      setError(null);
      setAutoResumeError(null);
      setIsIntentionalDisconnect(false);
      setCurrentRelayUsername(relayUsername);
      setCurrentRelayUrl(relayUrl);
      activeScopeRef.current = retainScope(activeScopeRef.current, {
        mode: "relay",
        endpoint: relayUrl,
        relayUsername,
        identity: srpUsername,
      });
      setCurrentDirectUrl(null);
      setCurrentHostId(hostForScope(activeScopeRef.current)?.id ?? null);
      onStatusChange?.("connecting_relay");

      try {
        const owner = rememberMe
          ? await captureCredential(
              attempt,
              {
                mode: "relay",
                endpoint: relayUrl,
                relayUsername,
                identity: srpUsername,
              },
              session,
            )
          : undefined;
        // 1. Connect to the relay and claim the server's waiting socket.
        const ws = await openRelayClientSocket({
          relayUrl,
          relayUsername,
          onOpen: () => {
            if (isCurrentConnectionAttempt(attempt)) {
              onStatusChange?.("waiting_server");
            }
          },
        });
        if (!isCurrentConnectionAttempt(attempt)) {
          ws.close();
          throw new ConnectionAttemptSupersededError();
        }

        // 2. Now we have a direct pipe to yepanywhere server - do SRP auth
        onStatusChange?.("authenticating");

        // Create SecureConnection using the existing WebSocket
        // If session is provided, use resume-only mode; otherwise do fresh SRP auth
        let conn: SecureConnection;
        if (session) {
          conn = await SecureConnection.forResumeOnlyWithSocket(
            ws,
            session,
            {
              isAttemptCurrent: () =>
                isCurrentConnectionAttempt(attempt) &&
                (!owner || isHostCredentialAttemptCurrent(owner.credential)),
              onSessionEstablished: rememberMe
                ? (establishedSession, kind) =>
                    handleSessionEstablished(
                      attempt,
                      owner!,
                      establishedSession,
                      kind,
                    )
                : undefined,
              onDisconnect: handleDisconnect,
            },
            { relayUrl, relayUsername },
          );
        } else {
          conn = await SecureConnection.connectWithExistingSocket(
            ws,
            srpUsername,
            srpPassword,
            {
              isAttemptCurrent: () =>
                isCurrentConnectionAttempt(attempt) &&
                (!owner || isHostCredentialAttemptCurrent(owner.credential)),
              onSessionEstablished: rememberMe
                ? (establishedSession, kind) =>
                    handleSessionEstablished(
                      attempt,
                      owner!,
                      establishedSession,
                      kind,
                    )
                : undefined,
              onDisconnect: handleDisconnect,
            },
            { relayUrl, relayUsername },
          );
        }

        if (!isCurrentConnectionAttempt(attempt)) {
          conn.close();
          throw new ConnectionAttemptSupersededError();
        }

        // Test the connection
        await conn.fetch("/auth/status");
        if (!isCurrentConnectionAttempt(attempt)) {
          conn.close();
          throw new ConnectionAttemptSupersededError();
        }

        if (!isCurrentConnectionAttempt(attempt)) {
          conn.close();
          throw new ConnectionAttemptSupersededError();
        }
        // Attach the source transport before connected routes render.
        publishConnection(conn);
      } catch (err) {
        if (isCurrentConnectionAttempt(attempt)) {
          const message =
            err instanceof Error ? err.message : "Connection failed";
          setError(message);
          onStatusChange?.("error");
        }
        throw err;
      } finally {
        if (isCurrentConnectionAttempt(attempt)) {
          setIsConnecting(false);
        }
      }
    },
    [
      beginConnectionAttempt,
      captureCredential,
      handleSessionEstablished,
      handleDisconnect,
      isCurrentConnectionAttempt,
      publishConnection,
      setCurrentHostId,
      setCurrentDirectUrl,
    ],
  );

  const disconnect = useCallback(
    (isIntentional = true) => {
      beginConnectionAttempt();
      // Use flushSync to ensure state updates are processed synchronously
      // before any navigation happens. This prevents race conditions where
      // ConnectionGate might redirect back to the host before seeing the disconnect.
      const clearConnection = () => {
        if (connectionRef.current) {
          connectionRef.current.close();
        }
        detachTransport();
        connectionRef.current = null;
        setConnection(null);
        setActiveSourceKey(null);
        clearTabHostSelection();
        setError(null);
        setAutoResumeError(null);
        // Clear host ID and optionally mark as intentional disconnect
        // Use isIntentional=false for programmatic host switches (e.g., browser back/forward)
        setCurrentHostId(null);
        setCurrentRelayUsername(null);
        setCurrentRelayUrl(null);
        setCurrentDirectUrl(null);
        setIsIntentionalDisconnect(isIntentional);
      };
      if (isIntentional) flushSync(clearConnection);
      else clearConnection();
    },
    [
      beginConnectionAttempt,
      detachTransport,
      setCurrentHostId,
      setCurrentDirectUrl,
    ],
  );

  const clearAutoResumeError = useCallback(() => {
    setAutoResumeError(null);
  }, []);

  const retryAutoResume = useCallback(() => {
    const stored = storedRef.current;
    const failedScope = activeScopeRef.current;
    if (
      !stored?.session ||
      (failedScope &&
        resumeScopeKey(credentialScope(stored)) !== resumeScopeKey(failedScope))
    )
      return;
    // Enter the retry state immediately so route gates do not briefly treat
    // the cleared error as a terminal auth failure before the effect starts.
    setIsAutoResuming(true);
    setAutoResumeError(null);
    setAutoResumeAttempted(false);
  }, []);

  useResumeRecovery(
    !connection &&
      !isAutoResuming &&
      !isConnecting &&
      !isIntentionalDisconnect &&
      !!autoResumeError &&
      canRetryResume(autoResumeError.reason),
    retryAutoResume,
  );

  // Auto-resume on mount if we have a stored session
  useEffect(() => {
    const currentStored = storedRef.current;

    // Only attempt once, and only if we have a stored session
    if (autoResumeAttempted || !currentStored?.session) {
      return;
    }

    setAutoResumeAttempted(true);

    // Try to resume the stored session without password
    const storedSession = currentStored.session;
    if (!storedSession) return; // Already checked above, but satisfies TypeScript

    const attemptAutoResume = async () => {
      const attempt = beginConnectionAttempt();
      console.log(
        "[RemoteConnection] Attempting auto-resume from stored session",
      );
      setIsConnecting(true);
      setIsAutoResuming(true);
      setError(null);

      try {
        const scope = credentialScope(currentStored);
        await mutateResumeCredentials(() => {
          if (!isCurrentConnectionAttempt(attempt)) return;
          if (!hostForScope(scope)) {
            const host =
              scope.mode === "relay"
                ? upsertRelayHost({
                    relayUrl: scope.endpoint,
                    relayUsername: scope.relayUsername!,
                    srpUsername: scope.identity,
                    session: storedSession,
                  })
                : {
                    ...createDirectHost({
                      wsUrl: scope.endpoint,
                      srpUsername: scope.identity,
                    }),
                    session: storedSession,
                  };
            if (scope.mode === "direct") saveHost(host);
          }
        });
        const owner = await captureCredential(attempt, scope, storedSession);
        let conn: SecureConnection;

        if (currentStored.mode === "relay") {
          setCurrentDirectUrl(null);
          // Relay mode: reconnect through relay, then resume SRP session
          console.log("[RemoteConnection] Auto-resume via relay");
          const relayUrl = currentStored.wsUrl;
          const relayUsername = currentStored.relayUsername;

          if (!relayUrl || !relayUsername) {
            throw new Error("Missing relay credentials for auto-resume");
          }
          setCurrentRelayUsername(relayUsername);
          setCurrentRelayUrl(relayUrl);

          // 1. Connect to the relay and claim the server's waiting socket.
          const ws = await openRelayClientSocket({
            relayUrl,
            relayUsername,
          });
          if (!isCurrentConnectionAttempt(attempt)) {
            ws.close();
            throw new ConnectionAttemptSupersededError();
          }

          // 2. Create SecureConnection for resume using the existing socket
          conn = await SecureConnection.forResumeOnlyWithSocket(
            ws,
            storedSession,
            {
              isAttemptCurrent: () =>
                isCurrentConnectionAttempt(attempt) &&
                (!owner || isHostCredentialAttemptCurrent(owner.credential)),
              onSessionEstablished: (session, kind) =>
                handleSessionEstablished(attempt, owner, session, kind),
              onDisconnect: handleDisconnect,
            },
            { relayUrl, relayUsername },
          );
        } else {
          setCurrentRelayUsername(null);
          setCurrentRelayUrl(null);
          setCurrentDirectUrl(currentStored.wsUrl);
          // Direct mode: just create connection and resume
          conn = SecureConnection.forResumeOnly(storedSession, {
            isAttemptCurrent: () =>
              isCurrentConnectionAttempt(attempt) &&
              (!owner || isHostCredentialAttemptCurrent(owner.credential)),
            onSessionEstablished: (session, kind) =>
              handleSessionEstablished(attempt, owner, session, kind),
            onDisconnect: handleDisconnect,
          });
        }

        if (!isCurrentConnectionAttempt(attempt)) {
          conn.close();
          throw new ConnectionAttemptSupersededError();
        }

        // Test the connection - this will try resume only
        await conn.fetch("/auth/status");
        if (!isCurrentConnectionAttempt(attempt)) {
          conn.close();
          throw new ConnectionAttemptSupersededError();
        }

        console.log("[RemoteConnection] Auto-resume successful");
        if (!isCurrentConnectionAttempt(attempt)) {
          conn.close();
          throw new ConnectionAttemptSupersededError();
        }
        // Attach the source transport before connected routes render.
        publishConnection(conn);
      } catch (err) {
        if (!isCurrentConnectionAttempt(attempt)) {
          throw err;
        }
        if (currentStored.mode !== "relay") {
          setCurrentHostId(null);
          setCurrentDirectUrl(null);
        }
        const message =
          getResumeError(err)?.message ??
          (err instanceof Error ? err.message : String(err));
        console.log("[RemoteConnection] Auto-resume failed:", message);

        // Create structured error for the modal
        const reason = categorizeResumeError(err);
        const isRelay = currentStored.mode === "relay";

        setAutoResumeError({
          reason,
          mode: isRelay ? "relay" : "direct",
          relayUsername: isRelay ? currentStored.relayUsername : undefined,
          serverUrl: currentStored.wsUrl,
          message,
        });
      } finally {
        if (isCurrentConnectionAttempt(attempt)) {
          setIsConnecting(false);
          setIsAutoResuming(false);
        }
      }
    };

    void attemptAutoResume();
  }, [
    autoResumeAttempted,
    beginConnectionAttempt,
    captureCredential,
    handleSessionEstablished,
    handleDisconnect,
    isCurrentConnectionAttempt,
    publishConnection,
    setCurrentHostId,
    setCurrentDirectUrl,
  ]);

  // Clean up connection on unmount only (not on connection changes)
  // Using empty deps + ref avoids the cleanup running when connection changes
  useEffect(() => {
    return () => {
      beginConnectionAttempt();
      if (connectionRef.current) {
        connectionRef.current.close();
      }
      detachTransport();
    };
  }, [beginConnectionAttempt, detachTransport]);

  const value: RemoteConnectionState = {
    connection,
    activeSourceKey,
    activeAuthenticationScope: activeScopeRef.current,
    isConnecting,
    isAutoResuming,
    error,
    autoResumeError,
    currentHostId,
    currentRelayUsername,
    currentRelayUrl,
    currentDirectUrl,
    setCurrentHostId,
    isIntentionalDisconnect,
    connect,
    connectViaRelay,
    disconnect,
    clearAutoResumeError,
    retryAutoResume,
    storedUrl: storedRef.current?.wsUrl ?? null,
    storedUsername: storedRef.current?.username ?? null,
    hasStoredSession: !!storedRef.current?.session,
    resumeSession,
  };

  return (
    <RemoteConnectionContext.Provider value={value}>
      {children}
    </RemoteConnectionContext.Provider>
  );
}

export function useRemoteConnection(): RemoteConnectionState {
  const context = useContext(RemoteConnectionContext);
  if (!context) {
    throw new Error(
      "useRemoteConnection must be used within RemoteConnectionProvider",
    );
  }
  return context;
}

/**
 * Hook to optionally access remote connection state.
 * Returns null if not within a RemoteConnectionProvider (e.g., non-remote mode).
 */
export function useOptionalRemoteConnection(): RemoteConnectionState | null {
  return useContext(RemoteConnectionContext);
}

/**
 * Hook to get the connection, throwing if not connected.
 * Use this in components that require an active connection.
 */
export function useRequiredConnection(): Connection {
  const { connection } = useRemoteConnection();
  if (!connection) {
    throw new Error("No active connection");
  }
  return connection;
}
