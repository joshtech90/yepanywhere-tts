/**
 * RelayConnectionGate - Layout route for relay host connections.
 *
 * Used as a layout route for /-/relay/:relayUsername/* in remote-main.tsx.
 * Manages the relay connection lifecycle:
 * - Extracts relayUsername from URL
 * - Looks up saved host by username
 * - Initiates connection if host found with valid session
 * - Redirects to login if no saved session
 * - Once connected, renders ConnectedAppContent + child routes via Outlet
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { HostOfflineModal } from "../components/HostOfflineModal";
import { StartupShell } from "../components/StartupShell";
import {
  type AutoResumeError,
  useRemoteConnection,
} from "../contexts/RemoteConnectionContext";
import {
  clearHostSession,
  getHostById,
  getHostByRelayUsername,
} from "../lib/hostStorage";
import { ConnectedAppContent } from "../RemoteApp";
import { useI18n } from "../i18n";

import { getResumeError } from "../lib/connection/resumeErrors";
import { useResumeRecovery } from "../hooks/useResumeRecovery";
import { signInRequiredState } from "../hooks/useSignInRequiredNotice";
import {
  canRetryResume,
  categorizeResumeError,
  requiresResumeLogin,
} from "../lib/connection/remoteErrors";

type ConnectionState =
  | "checking"
  | "connecting"
  | "connected"
  | "no_host"
  | "no_session"
  | "error";

/** Create an AutoResumeError from an exception */
function createAutoResumeError(
  err: unknown,
  relayUsername: string,
  relayUrl?: string,
): AutoResumeError {
  const message =
    getResumeError(err)?.message ??
    (err instanceof Error ? err.message : String(err));
  const reason = categorizeResumeError(err);

  return {
    reason,
    mode: "relay",
    relayUsername,
    serverUrl: relayUrl,
    message,
  };
}

/**
 * Layout route that manages relay connection and renders child routes when connected.
 */
export function RelayConnectionGate() {
  const { t } = useI18n();
  const { relayUsername } = useParams<{ relayUsername: string }>();
  const location = useLocation();
  const {
    connection,
    connectViaRelay,
    isAutoResuming,
    autoResumeError,
    setCurrentHostId,
    currentHostId,
    currentRelayUsername,
    isIntentionalDisconnect,
    disconnect,
  } = useRemoteConnection();

  const [state, setState] = useState<ConnectionState>("checking");
  const [error, setError] = useState<AutoResumeError | null>(null);
  const [lastConnectedRelayUsername, setLastConnectedRelayUsername] = useState<
    string | null
  >(null);
  const [dismissedError, setDismissedError] = useState<AutoResumeError | null>(
    null,
  );
  const returnTo = useMemo(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search],
  );
  const relayLoginTarget = useMemo(() => {
    const params = new URLSearchParams();
    if (relayUsername) {
      params.set("u", relayUsername);
    }
    const host = relayUsername ? getHostByRelayUsername(relayUsername) : null;
    if (host?.relayUrl) {
      params.set("r", host.relayUrl);
    }
    params.set("returnTo", returnTo);
    return `/login/relay?${params.toString()}`;
  }, [relayUsername, returnTo]);
  const routeRelayUsernameRef = useRef(relayUsername);
  routeRelayUsernameRef.current = relayUsername;
  const connectionAttemptRef = useRef(0);
  const pendingRelayUsernameRef = useRef<string | null>(null);

  const startRelayConnection = useCallback(
    (
      host: NonNullable<ReturnType<typeof getHostByRelayUsername>>,
      targetRelayUsername: string,
      replacePending = false,
    ) => {
      if (
        !replacePending &&
        pendingRelayUsernameRef.current === targetRelayUsername
      ) {
        return;
      }
      if (!host.session || !host.relayUrl) {
        setState("no_session");
        return;
      }

      const attempt = connectionAttemptRef.current + 1;
      connectionAttemptRef.current = attempt;
      pendingRelayUsernameRef.current = targetRelayUsername;
      setState("connecting");
      setError(null);
      setDismissedError(null);
      setCurrentHostId(host.id);

      void connectViaRelay({
        relayUrl: host.relayUrl,
        relayUsername: host.relayUsername ?? targetRelayUsername,
        srpUsername: host.srpUsername,
        srpPassword: "",
        rememberMe: true,
        onStatusChange: () => {},
        session: host.session,
      })
        .then(() => {
          if (
            connectionAttemptRef.current !== attempt ||
            routeRelayUsernameRef.current !== targetRelayUsername
          ) {
            return;
          }
          pendingRelayUsernameRef.current = null;
          setLastConnectedRelayUsername(targetRelayUsername);
          setState("connected");
        })
        .catch((err) => {
          if (
            connectionAttemptRef.current !== attempt ||
            routeRelayUsernameRef.current !== targetRelayUsername
          ) {
            return;
          }
          pendingRelayUsernameRef.current = null;
          const autoResumeError = createAutoResumeError(
            err,
            host.relayUsername ?? targetRelayUsername,
            host.relayUrl,
          );
          if (requiresResumeLogin(autoResumeError.reason)) {
            clearHostSession(host.id);
          }
          setError(autoResumeError);
          setState("error");
        });
    },
    [connectViaRelay, setCurrentHostId],
  );

  useEffect(() => {
    return () => {
      connectionAttemptRef.current += 1;
      pendingRelayUsernameRef.current = null;
      disconnect(false);
    };
  }, [disconnect]);

  // Attempt to connect when username changes
  useEffect(() => {
    if (!relayUsername) {
      setState("no_host");
      return;
    }

    // If already connected, check if it's to the right host
    if (connection) {
      const currentHost = currentHostId ? getHostById(currentHostId) : null;
      const connectedRelayUsername =
        currentRelayUsername ?? currentHost?.relayUsername;

      if (connectedRelayUsername === relayUsername) {
        setLastConnectedRelayUsername(relayUsername);
        setDismissedError(null);
        setState("connected");
        return;
      }

      // If currentHostId is not set (e.g., after auto-resume from old storage),
      // try to find the host by relay username and set it
      if (!currentHostId) {
        const hostByUsername = getHostByRelayUsername(relayUsername);
        if (hostByUsername) {
          console.log(
            `[RelayConnectionGate] Connection without hostId, setting to "${hostByUsername.id}" for "${relayUsername}"`,
          );
          setCurrentHostId(hostByUsername.id);
          setLastConnectedRelayUsername(relayUsername);
          setDismissedError(null);
          setState("connected");
          return;
        }
        console.log(
          `[RelayConnectionGate] Connection without hostId and no saved host for "${relayUsername}", redirecting to login`,
        );
        disconnect(false);
        setState("no_host");
        return;
      }

      // Connected to a different host - disconnect and let the effect reconnect
      console.log(
        `[RelayConnectionGate] Host mismatch: connected to "${connectedRelayUsername}" but URL wants "${relayUsername}", switching...`,
      );
      disconnect(false);
      setState("connecting");
      return;
    }

    // If user intentionally disconnected (e.g., clicked "Switch Host"),
    // don't try to reconnect - they're navigating away
    if (isIntentionalDisconnect) {
      console.log(
        `[RelayConnectionGate] Intentional disconnect, not reconnecting to "${relayUsername}"`,
      );
      return;
    }

    // If auto-resume is in progress, wait for it
    if (isAutoResuming) {
      console.log(
        `[RelayConnectionGate] Auto-resume in progress, waiting... (relayUsername="${relayUsername}")`,
      );
      setState("connecting");
      return;
    }

    if (autoResumeError && currentRelayUsername === relayUsername) {
      setError(autoResumeError);
      setState("error");
      return;
    }

    // Look up saved host by relay username
    const host = getHostByRelayUsername(relayUsername);
    console.log(
      `[RelayConnectionGate] Looking up host for "${relayUsername}":`,
      host
        ? {
            id: host.id,
            hasSession: !!host.session,
            hasRelayUrl: !!host.relayUrl,
          }
        : "not found",
    );

    if (!host) {
      console.log(
        `[RelayConnectionGate] No saved host for "${relayUsername}", redirecting to login`,
      );
      setState("no_host");
      return;
    }

    if (!host.session || !host.relayUrl) {
      console.log(
        `[RelayConnectionGate] Host "${relayUsername}" has no session or relayUrl, redirecting to login`,
      );
      setState("no_session");
      return;
    }

    startRelayConnection(host, relayUsername);
  }, [
    relayUsername,
    autoResumeError,
    connection,
    isAutoResuming,
    currentHostId,
    currentRelayUsername,
    isIntentionalDisconnect,
    disconnect,
    startRelayConnection,
    setCurrentHostId,
  ]);

  const retryConnection = () => {
    const targetRelayUsername = relayUsername ?? "";
    const host = getHostByRelayUsername(targetRelayUsername);
    if (host) {
      startRelayConnection(host, targetRelayUsername, true);
    } else {
      setState("no_session");
    }
  };

  useResumeRecovery(
    state === "error" &&
      !!error &&
      canRetryResume(error.reason) &&
      !connection &&
      !isAutoResuming &&
      !autoResumeError &&
      !isIntentionalDisconnect,
    retryConnection,
  );

  if (isIntentionalDisconnect) {
    return <Navigate to="/login" replace />;
  }

  if (state === "no_host" || state === "no_session") {
    return <Navigate to={relayLoginTarget} replace />;
  }

  // A route that connected successfully remains mounted through later network
  // failures. The error is presented as a sibling portal so dismissing it
  // reveals the exact in-memory page state that was already on screen.
  if (lastConnectedRelayUsername === relayUsername) {
    const visibleError =
      state === "error" && error && dismissedError !== error ? error : null;

    return (
      <>
        <ConnectedAppContent>
          <Outlet />
        </ConnectedAppContent>
        {visibleError && (
          <HostOfflineModal
            error={visibleError}
            onDismiss={() => setDismissedError(visibleError)}
            onRetry={retryConnection}
            onGoToLogin={() => setState("no_session")}
          />
        )}
      </>
    );
  }

  switch (state) {
    case "checking":
    case "connecting":
      return (
        <StartupShell phase="connection">
          {t("remoteConnectingToHost", {
            host: relayUsername ?? "",
          })}
        </StartupShell>
      );

    case "error": {
      // With no page mounted there is nothing to preserve, so a confirmed
      // rejection goes straight to the login form, which explains why.
      if (error && requiresResumeLogin(error.reason)) {
        return (
          <Navigate
            to={relayLoginTarget}
            replace
            state={signInRequiredState(error.reason)}
          />
        );
      }
      const defaultError: AutoResumeError = {
        reason: "other",
        mode: "relay",
        relayUsername: relayUsername ?? "",
        message: "Connection failed",
      };
      return (
        <HostOfflineModal
          error={error ?? defaultError}
          onDismiss={() => setState("no_session")}
          onRetry={retryConnection}
          onGoToLogin={() => setState("no_session")}
        />
      );
    }

    case "connected":
      return (
        <ConnectedAppContent>
          <Outlet />
        </ConnectedAppContent>
      );
  }
}
