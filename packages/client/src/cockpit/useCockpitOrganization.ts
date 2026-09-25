import { useCallback, useEffect, useMemo, useState } from "react";
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
}

function activeView(
  state: CockpitOrganizationState,
): CockpitSavedView | undefined {
  return state.views.find((view) => view.id === state.activeViewId);
}

export function useCockpitOrganization(): CockpitOrganizationController {
  const runtime = useCurrentSourceRuntime();
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
        setPinError(true);
        return false;
      } finally {
        setPendingPins((current) => {
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [runtime],
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
    }),
    [
      activateView,
      clearActiveView,
      pendingPins,
      pinError,
      pinnedOnly,
      removeView,
      saveView,
      setPinnedOnly,
      state.activeViewId,
      state.views,
      togglePin,
    ],
  );
}
