import { useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { clearSessionViewer } from "../lib/sessionViewerController";

/** The vhost a pane is showing, while that pane is worth polling. */
export interface VhostListenerTarget {
  /** Vhost row name, as the artifacts API spells it. */
  name: string;
  /** The app URL the pane is showing, so a stale answer is recognizable. */
  url: string;
}

export interface VhostListener {
  viewerId: string;
  url: string;
  name: string;
  token: string | null;
  error?: string;
}

const POLL_INTERVAL_MS = 3000;

/**
 * Track whether the app a pane is showing still has a listener.
 *
 * Polling runs only while the caller supplies a target — an open, unminimized
 * pane on a server that can stop apps — and pauses while the tab is hidden. An
 * app that goes away closes the pane it loaded, so a frame never sits on a dead
 * app; a target that merely stops being pollable keeps its last answer, since
 * minimizing a pane does not make what it knows untrue. Only the viewer going
 * away discards it.
 */
export function useVhostListener(
  target: VhostListenerTarget | undefined,
  viewerId: string | undefined,
): { listener: VhostListener | undefined; onFrameLoad: () => void } {
  const runtime = useCurrentSourceRuntime();
  const loadedFrame = useRef<string | undefined>(undefined);
  const [listener, setListener] = useState<VhostListener>();

  useEffect(() => {
    if (!viewerId) {
      loadedFrame.current = undefined;
      setListener(undefined);
      return;
    }
    if (!target) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    const check = () => {
      if (cancelled || pending || document.visibilityState === "hidden") return;
      pending = true;
      runtime.transport
        .fetch<{ token: string | null }>(
          `/artifacts/vhosts/${encodeURIComponent(target.name)}/listener`,
        )
        .then(
          ({ token }) => {
            if (cancelled) return;
            if (!token && loadedFrame.current === viewerId) {
              clearSessionViewer(viewerId);
              return;
            }
            setListener({
              viewerId,
              url: target.url,
              name: target.name,
              token,
            });
            if (token) timer = setTimeout(check, POLL_INTERVAL_MS);
          },
          (error: unknown) => {
            if (cancelled) return;
            setListener({
              viewerId,
              url: target.url,
              name: target.name,
              token: null,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        )
        .finally(() => {
          pending = false;
        });
    };
    const visibilityChanged = () => {
      clearTimeout(timer);
      check();
    };
    check();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [target, viewerId, runtime]);

  return {
    listener,
    onFrameLoad: () => {
      if (listener?.viewerId === viewerId && listener?.token)
        loadedFrame.current = viewerId;
    },
  };
}
