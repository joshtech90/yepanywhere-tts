import { useCallback, useMemo } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useSession } from "../hooks/useSession";
import { buildSessionDetailRenderItems } from "../lib/sessionDetail/renderItems";
import type {
  InputRequest,
  SessionMetadata,
  SessionStatus,
  UserQuestionAnswers,
} from "../types";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";
import {
  readCockpitPendingInput,
  respondToCockpitInput,
} from "./core/inputRequest";
import {
  createCockpitTranscriptEntries,
  type CockpitTranscriptEntry,
} from "./core/sessionDetail";

export interface CockpitSessionDetailData {
  composer: CockpitComposerSessionPort;
  entries: CockpitTranscriptEntry[];
  error: Error | null;
  hasOlderMessages: boolean;
  loadOlderMessages: () => Promise<void>;
  loading: boolean;
  loadingOlder: boolean;
  pendingInputRequest: InputRequest | null;
  processState: "idle" | "in-turn" | "waiting-input";
  refreshPendingInput: () => Promise<InputRequest | null>;
  reloadSession: () => void;
  respondToInput: (
    requestId: string,
    response: "approve" | "approve_accept_edits" | "deny",
    answers?: UserQuestionAnswers,
    feedback?: string,
  ) => Promise<void>;
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
  const actualSessionId = detail.actualSessionId;
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
  const respondToInput = useCallback<CockpitSessionDetailData["respondToInput"]>(
    async (requestId, response, answers, feedback) => {
      const nextRequest = await respondToCockpitInput(
        runtime.transport,
        actualSessionId,
        requestId,
        response,
        answers,
        feedback,
      );
      detail.setPendingInputRequest(nextRequest);
      if (response === "approve_accept_edits") {
        detail.setPermissionMode("acceptEdits");
      }
    },
    [
      actualSessionId,
      detail.setPendingInputRequest,
      detail.setPermissionMode,
      runtime.transport,
    ],
  );
  const refreshPendingInput = useCallback(async () => {
    const nextRequest = await readCockpitPendingInput(
      runtime.transport,
      actualSessionId,
    );
    detail.setPendingInputRequest(nextRequest);
    return nextRequest;
  }, [actualSessionId, detail.setPendingInputRequest, runtime.transport]);

  return {
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
    pendingInputRequest:
      detail.pendingInputRequest?.sessionId === actualSessionId
        ? detail.pendingInputRequest
        : null,
    processState: detail.processState,
    refreshPendingInput,
    reloadSession: detail.reloadSession,
    respondToInput,
    restoredFromSnapshot: detail.restoredFromSnapshot,
    session: detail.session,
    setSessionModel: detail.setSessionModel,
    sessionUpdatesConnected: detail.sessionUpdatesConnected,
    sessionUpdatesResubscribing: detail.sessionUpdatesResubscribing,
    status: detail.status,
  };
}
