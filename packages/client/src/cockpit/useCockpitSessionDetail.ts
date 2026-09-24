import { useMemo } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useSession } from "../hooks/useSession";
import { buildSessionDetailRenderItems } from "../lib/sessionDetail/renderItems";
import type { SessionMetadata, SessionStatus } from "../types";
import {
  createCockpitTranscriptEntries,
  type CockpitTranscriptEntry,
} from "./core/sessionDetail";

export interface CockpitSessionDetailData {
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

  return {
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
    sessionUpdatesConnected: detail.sessionUpdatesConnected,
    sessionUpdatesResubscribing: detail.sessionUpdatesResubscribing,
    status: detail.status,
  };
}
