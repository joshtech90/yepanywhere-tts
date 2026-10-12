import { subscribeDeveloperMode } from "../hooks/useDeveloperMode";
import { getResumeError } from "./connection/resumeErrors";
import { openRelayClientSocket } from "./connection/RelayClientSocket";
import { SecureConnection } from "./connection/SecureConnection";
import type { SecureConnectionSocket } from "./connection/SecureConnectionSocket";
import {
  acquireRetainedResume,
  appendResumeProbeEvidence,
  forgetRetainedResumes,
  initResumeRetention,
  listRetainedResumes,
  retentionEnabled,
  resumeGeneration,
  resumeScopeKey,
  subscribeResumeErasure,
} from "./rejectedResumeStorage";
import type { ResumeObservation } from "./resumeDiagnostics";

interface ResumeDebugger {
  list: typeof listRetainedResumes;
  probe: (id: string) => Promise<{ outcome: string }>;
  forget: (id: string) => void;
  cancel: (id: string) => void;
}
declare global {
  interface Window {
    __YA_RESUME_DEBUG__?: ResumeDebugger;
  }
}
/** Install even on the login route; there is intentionally no diagnostic UI. */
export function initResumeDebugger(): () => void {
  const probes = new Map<string, { id: string; abort: AbortController }>();
  const cancelAll = () => {
    for (const probe of probes.values()) probe.abort.abort();
  };
  const stopRetention = initResumeRetention();
  const stopErasure = subscribeResumeErasure(cancelAll);
  const helper: ResumeDebugger = {
    list: listRetainedResumes,
    forget: (id) => forgetRetainedResumes(undefined, id),
    cancel: (id) => {
      for (const probe of probes.values())
        if (probe.id === id) probe.abort.abort();
    },
    probe: async (id) => {
      const generation = resumeGeneration();
      let record: Awaited<ReturnType<typeof acquireRetainedResume>>;
      try {
        record = await acquireRetainedResume(id);
      } catch {
        return { outcome: "storage_failure" };
      }
      if (!record || generation !== resumeGeneration() || !retentionEnabled())
        return { outcome: "unavailable" };
      const scope = resumeScopeKey(record.scope);
      if (probes.has(scope)) return { outcome: "busy" };
      const abort = new AbortController();
      probes.set(scope, { id, abort });
      let connection: SecureConnection | undefined;
      let socket: SecureConnectionSocket | undefined;
      const evidence: ResumeObservation[] = [];
      const close = () => {
        connection?.close();
        socket?.close();
      };
      abort.signal.addEventListener("abort", close);
      const deadline = setTimeout(
        () => abort.abort(),
        Math.min(35_000, record.expiresAt - Date.now()),
      );
      try {
        const callbacks = {
          diagnosticProbe: true,
          isAttemptCurrent: () =>
            !abort.signal.aborted && generation === resumeGeneration(),
          onResumeObservation: (event: ResumeObservation) => {
            evidence.push(event);
            if (evidence.length > 8) evidence.shift();
          },
        };
        if (record.scope.mode === "relay") {
          socket = await openRelayClientSocket({
            relayUrl: record.scope.endpoint,
            relayUsername: record.scope.relayUsername ?? "",
            signal: abort.signal,
          });
          if (abort.signal.aborted) return { outcome: "cancelled" };
          connection = await SecureConnection.forResumeOnlyWithSocket(
            socket,
            record.session,
            callbacks,
            {
              relayUrl: record.scope.endpoint,
              relayUsername: record.scope.relayUsername ?? "",
            },
          );
        } else
          connection = SecureConnection.forResumeOnly(
            record.session,
            callbacks,
          );
        if (abort.signal.aborted) return { outcome: "cancelled" };
        // fetch exercises the existing authenticated, encrypted request path.
        await connection.fetch("/auth/status");
        if (abort.signal.aborted || generation !== resumeGeneration())
          return { outcome: "cancelled" };
        return { outcome: "authenticated" };
      } catch (error) {
        return {
          outcome: abort.signal.aborted
            ? "cancelled"
            : (getResumeError(error)?.kind ?? "connection_failed"),
        };
      } finally {
        clearTimeout(deadline);
        close();
        abort.signal.removeEventListener("abort", close);
        probes.delete(scope);
        try {
          await appendResumeProbeEvidence(id, generation, evidence);
        } catch {
          /* sanitized result only */
        }
      }
    },
  };
  const sync = () => {
    if (retentionEnabled()) window.__YA_RESUME_DEBUG__ = helper;
    else {
      cancelAll();
      delete window.__YA_RESUME_DEBUG__;
    }
  };
  const unsubscribe = subscribeDeveloperMode(sync);
  window.addEventListener("storage", sync);
  sync();
  return () => {
    cancelAll();
    stopRetention();
    stopErasure();
    unsubscribe();
    window.removeEventListener("storage", sync);
    if (window.__YA_RESUME_DEBUG__ === helper)
      delete window.__YA_RESUME_DEBUG__;
  };
}
