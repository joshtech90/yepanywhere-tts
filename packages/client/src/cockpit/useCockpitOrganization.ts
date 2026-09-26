import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import {
  activateCockpitView,
  type CockpitOrganizationState,
  type CockpitSavedView,
  readCockpitOrganization,
  removeCockpitView,
  saveCockpitView,
} from "./core/organization";

export interface CockpitOrganizationController {
  activeViewId: string | null;
  pinError: boolean;
  pinnedOnly: boolean;
  pendingPins: ReadonlySet<string>;
  views: CockpitSavedView[];
  activateView: (viewId: string) => CockpitSavedView | undefined;
  clearActiveView: () => void;
  removeView: (viewId: string) => void;
  saveView: (input: {
    label: string;
    query: string;
    pinnedOnly: boolean;
  }) => CockpitSavedView | undefined;
  setPinnedOnly: (value: boolean) => void;
  togglePin: (sessionId: string, pinned: boolean) => Promise<boolean>;
  renameSession: (sessionId: string, title: string) => Promise<boolean>;
  /** YA cannot delete transcripts; archiving hides the session. */
  archiveSession: (sessionId: string) => Promise<boolean>;
  unarchiveSession: (sessionId: string) => Promise<boolean>;
}

function activeView(
  state: CockpitOrganizationState,
): CockpitSavedView | undefined {
  return state.views.find((view) => view.id === state.activeViewId);
}

export function useCockpitOrganization(): CockpitOrganizationController {
  const runtime = useCurrentSourceRuntime();
  const sourceGenerationRef = useRef({
    generation: 0,
    sourceKey: runtime.sourceKey,
  });
  if (sourceGenerationRef.current.sourceKey !== runtime.sourceKey) {
    sourceGenerationRef.current = {
      generation: sourceGenerationRef.current.generation + 1,
      sourceKey: runtime.sourceKey,
    };
  }
  const [state, setState] = useState(() =>
    readCockpitOrganization(runtime.sourceKey),
  );
  const [pinnedOnly, setPinnedOnlyState] = useState(
    () => activeView(state)?.pinnedOnly ?? false,
  );
  const [pendingPins, setPendingPins] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    const next = readCockpitOrganization(runtime.sourceKey);
    setState(next);
    setPinnedOnlyState(activeView(next)?.pinnedOnly ?? false);
    setPendingPins(new Set<string>());
    setPinError(false);
  }, [runtime.sourceKey]);

  const clearActiveView = useCallback(() => {
    if (!state.activeViewId) return;
    setState(activateCockpitView(runtime.sourceKey, null));
  }, [runtime.sourceKey, state.activeViewId]);

  const setPinnedOnly = useCallback(
    (value: boolean) => {
      setPinnedOnlyState(value);
      setState(activateCockpitView(runtime.sourceKey, null));
    },
    [runtime.sourceKey],
  );

  const saveView = useCallback(
    (input: { label: string; query: string; pinnedOnly: boolean }) => {
      const label = input.label.trim();
      if (!label || (!input.query.trim() && !input.pinnedOnly)) {
        return undefined;
      }
      const next = saveCockpitView(runtime.sourceKey, {
        label,
        query: input.query.trim(),
        pinnedOnly: input.pinnedOnly,
      });
      setState(next);
      setPinnedOnlyState(input.pinnedOnly);
      return activeView(next);
    },
    [runtime.sourceKey],
  );

  const activateView = useCallback(
    (viewId: string) => {
      const next = activateCockpitView(runtime.sourceKey, viewId);
      setState(next);
      const view = activeView(next);
      setPinnedOnlyState(view?.pinnedOnly ?? false);
      return view;
    },
    [runtime.sourceKey],
  );

  const removeView = useCallback(
    (viewId: string) => {
      const next = removeCockpitView(runtime.sourceKey, viewId);
      setState(next);
      if (!next.activeViewId) setPinnedOnlyState(false);
    },
    [runtime.sourceKey],
  );

  const togglePin = useCallback(
    async (sessionId: string, pinned: boolean) => {
      const sourceGeneration = sourceGenerationRef.current.generation;
      setPendingPins((current) => new Set(current).add(sessionId));
      setPinError(false);
      try {
        const result = await runtime.transport.fetch<{ updated: boolean }>(
          `/sessions/${encodeURIComponent(sessionId)}/metadata`,
          {
            method: "PUT",
            body: JSON.stringify({ starred: pinned }),
          },
        );
        if (!result.updated) {
          throw new Error("Session metadata was not updated");
        }
        runtime.summary.reportSessionCollectionMetadataChanged({
          type: "session-metadata-changed",
          sessionId,
          starred: pinned,
          timestamp: new Date().toISOString(),
        });
        return true;
      } catch {
        if (sourceGenerationRef.current.generation === sourceGeneration) {
          setPinError(true);
        }
        return false;
      } finally {
        if (sourceGenerationRef.current.generation === sourceGeneration) {
          setPendingPins((current) => {
            const next = new Set(current);
            next.delete(sessionId);
            return next;
          });
        }
      }
    },
    [runtime],
  );

  const writeMetadata = useCallback(
    async (
      sessionId: string,
      patch: { title: string } | { archived: boolean },
    ): Promise<boolean> => {
      try {
        const result = await runtime.transport.fetch<{ updated: boolean }>(
          `/sessions/${encodeURIComponent(sessionId)}/metadata`,
          { method: "PUT", body: JSON.stringify(patch) },
        );
        if (!result.updated) return false;
        // The server announces the change too; reporting the confirmed value
        // now keeps the list from showing the old title until that arrives.
        runtime.summary.reportSessionCollectionMetadataChanged({
          type: "session-metadata-changed",
          sessionId,
          ...patch,
          timestamp: new Date().toISOString(),
        });
        return true;
      } catch {
        return false;
      }
    },
    [runtime],
  );
  const renameSession = useCallback(
    (sessionId: string, title: string) =>
      writeMetadata(sessionId, { title: title.trim() }),
    [writeMetadata],
  );
  const archiveSession = useCallback(
    (sessionId: string) => writeMetadata(sessionId, { archived: true }),
    [writeMetadata],
  );
  const unarchiveSession = useCallback(
    (sessionId: string) => writeMetadata(sessionId, { archived: false }),
    [writeMetadata],
  );

  return useMemo(
    () => ({
      activeViewId: state.activeViewId,
      pinError,
      pinnedOnly,
      pendingPins,
      views: state.views,
      activateView,
      clearActiveView,
      removeView,
      saveView,
      setPinnedOnly,
      togglePin,
      renameSession,
      archiveSession,
      unarchiveSession,
    }),
    [
      activateView,
      archiveSession,
      clearActiveView,
      pendingPins,
      pinError,
      pinnedOnly,
      removeView,
      renameSession,
      saveView,
      setPinnedOnly,
      state.activeViewId,
      state.views,
      togglePin,
      unarchiveSession,
    ],
  );
}
