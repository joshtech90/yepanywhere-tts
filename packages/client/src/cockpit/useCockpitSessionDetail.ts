import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  CODEX_STREAM_DURABLE_ID_ALIGNMENT_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useSession } from "../hooks/useSession";
import { useVersion } from "../hooks/useVersion";
import { buildSessionDetailRenderItems } from "../lib/sessionDetail/renderItems";
import { parseSessionNavigationState } from "../lib/sessionNavigationState";
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
  // A session the Cockpit just started carries its live process in the
  // navigation state, so the stream connects without waiting for REST.
  const location = useLocation();
  const { initialStatus } = parseSessionNavigationState(location.state);
  // Same switch as the classic session page: without it a live Codex tool
  // call shows twice until reload, once under its stream id and once under
  // its durable transcript id.
  const { version } = useVersion();
  const codexStreamDurableIdAlignment = serverHasCapability(
    version,
    CODEX_STREAM_DURABLE_ID_ALIGNMENT_CAPABILITY,
  );
  const sessionOptions = useMemo(
    () => ({ codexStreamDurableIdAlignment }),
    [codexStreamDurableIdAlignment],
  );
  const detail = useSession(
    projectId,
    sessionId,
    initialStatus,
    undefined,
    sessionOptions,
  );
  const previousRenderItemsRef = useRef<RenderItem[]>([]);
  const previousEntriesRef = useRef<CockpitTranscriptEntry[]>([]);
  const renderItems = useMemo(
    () =>
      buildSessionDetailRenderItems({
        messages: detail.messages,
        provider: detail.session?.provider,
        markdownAugments: detail.markdownAugments,
        transcriptDisplayObjects: detail.session?.transcriptDisplayObjects,
        previousRenderItems: previousRenderItemsRef.current,
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
        previousEntries: previousEntriesRef.current,
        sourceKey: runtime.sourceKey,
        sessionId,
        renderItems,
      }),
    [renderItems, runtime.sourceKey, sessionId],
  );
  useEffect(() => {
    previousRenderItemsRef.current = renderItems;
    previousEntriesRef.current = entries;
  }, [entries, renderItems]);
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
