import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  CODEX_STREAM_DURABLE_ID_ALIGNMENT_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useSession } from "../hooks/useSession";
import { useVersion } from "../hooks/useVersion";
import { getSessionActivityUiState } from "../lib/sessionActivityUi";
import { buildSessionDetailRenderItems } from "../lib/sessionDetail/renderItems";
import { parseSessionNavigationState } from "../lib/sessionNavigationState";
import type { SessionMetadata, SessionStatus } from "../types";
import {
  useCockpitAttention,
  type CockpitAttentionPort,
} from "./useCockpitAttention";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";
import {
  COCKPIT_FOREIGN_TOOL_MAX_AGE_MS,
  inspectCockpitLatestTurn,
  isCockpitSessionWorkingElsewhere,
} from "./core/activity";
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
  /** Another program is working in this session right now. */
  workingElsewhere: boolean;
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
        // The server marks every unanswered tool_use as orphaned when it reads
        // a transcript, including the one another program is running right
        // now. Keep the latest turn's calls pending here; the transcript row
        // decides from the session's working state whether it says "running"
        // or "no result".
        activeToolApproval: true,
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
  const owner = detail.status.owner;
  const latestTurn = useMemo(() => {
    const turn = inspectCockpitLatestTurn(renderItems);
    if (turn.settled || turn.openToolCallAt === null) return turn;
    // A provider may close a turn with only a completion message after an
    // unanswered call; the existing activity rules already recognise that.
    const { latestTurnCompleted } = getSessionActivityUiState({
      owner,
      processState: detail.processState,
      items: renderItems,
      messages: detail.messages,
    });
    return latestTurnCompleted ? { ...turn, settled: true } : turn;
  }, [detail.messages, detail.processState, owner, renderItems]);
  const quietOpenTool =
    owner === "none" &&
    detail.processState === "idle" &&
    !latestTurn.settled &&
    latestTurn.openToolCallAt !== null;
  const [now, setNow] = useState(() => Date.now());
  // Only a quiet open tool call depends on the clock: it has to stop counting
  // as work once it is too old, without waiting for another event.
  useEffect(() => {
    if (!quietOpenTool) return;
    setNow(Date.now());
    const timer = setInterval(
      () => setNow(Date.now()),
      Math.min(60_000, COCKPIT_FOREIGN_TOOL_MAX_AGE_MS),
    );
    return () => clearInterval(timer);
  }, [quietOpenTool]);
  const workingElsewhere = isCockpitSessionWorkingElsewhere({
    owner,
    processState: detail.processState,
    latestTurn,
    now,
  });
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
    workingElsewhere,
  };
}
