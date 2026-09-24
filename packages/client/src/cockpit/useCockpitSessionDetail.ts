import { useMemo } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useSession } from "../hooks/useSession";
import { buildSessionDetailRenderItems } from "../lib/sessionDetail/renderItems";
import type { SessionMetadata, SessionStatus } from "../types";
import {
  useCockpitAttention,
  type CockpitAttentionPort,
} from "./useCockpitAttention";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";
import {
  createCockpitTranscriptEntries,
  type CockpitTranscriptEntry,
} from "./core/sessionDetail";

export interface CockpitSessionDetailData {
  attention: CockpitAttentionPort;
  composer: CockpitComposerSessionPort;
  entries: CockpitTranscriptEntry[];
  error: Error | null;
  hasOlderMessages: boolean;
  loadOlderMessages: () => Promise<void>;
  loading: boolean;
  loadingOlder: boolean;
  processState: "idle" | "in-turn" | "waiting-input";
  reloadSession: () => void;
  restoredFromSnapshot: boolean;
  session: SessionMetadata | null;
  setSessionModel: (model: string) => void;
  sessionUpdatesConnected: boolean;
  sessionUpdatesResubscribing: boolean;
  status: SessionStatus;
}

/**
 * Composition boundary for the read-only Cockpit transcript. useSession owns
 * the canonical detail-store retain/release lifecycle, catch-up, pagination,
 * provider streams, and reconnect behavior; this hook only selects a quiet
 * presentation model from that existing state.
 */
export function useCockpitSessionDetail(
  projectId: string,
  sessionId: string,
): CockpitSessionDetailData {
  const runtime = useCurrentSourceRuntime();
  const detail = useSession(projectId, sessionId);
  const renderItems = useMemo(
    () =>
      buildSessionDetailRenderItems({
        messages: detail.messages,
        provider: detail.session?.provider,
        markdownAugments: detail.markdownAugments,
        transcriptDisplayObjects: detail.session?.transcriptDisplayObjects,
      }),
    [
      detail.markdownAugments,
      detail.messages,
      detail.session?.provider,
      detail.session?.transcriptDisplayObjects,
    ],
  );
  const entries = useMemo(
    () =>
      createCockpitTranscriptEntries({
        sourceKey: runtime.sourceKey,
        sessionId,
        renderItems,
      }),
    [renderItems, runtime.sourceKey, sessionId],
  );
  const attention = useCockpitAttention({
    pendingInputRequest: detail.pendingInputRequest,
    processState: detail.processState,
    setPendingInputRequest: detail.setPendingInputRequest,
    setProcessState: detail.setProcessState,
    setStatus: detail.setStatus,
    status: detail.status,
  });

  return {
    attention,
    composer: {
      actualSessionId: detail.actualSessionId,
      addPendingMessage: detail.addPendingMessage,
      permissionMode: detail.permissionMode,
      processState: detail.processState,
      reconnectStream: detail.reconnectStream,
      removePendingMessage: detail.removePendingMessage,
      session: detail.session,
      setDeferredMessages: detail.setDeferredMessages,
      setProcessState: detail.setProcessState,
      setStatus: detail.setStatus,
      status: detail.status,
    },
    entries,
    error: detail.error,
    hasOlderMessages: detail.pagination?.hasOlderMessages === true,
    loadOlderMessages: detail.loadOlderMessages,
    loading: detail.loading,
    loadingOlder: detail.loadingOlder,
    processState: detail.processState,
    reloadSession: detail.reloadSession,
    restoredFromSnapshot: detail.restoredFromSnapshot,
    session: detail.session,
    setSessionModel: detail.setSessionModel,
    sessionUpdatesConnected: detail.sessionUpdatesConnected,
    sessionUpdatesResubscribing: detail.sessionUpdatesResubscribing,
    status: detail.status,
  };
}
