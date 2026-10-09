import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { browserDeviceName, browserTabId } from "../lib/browserTab";
import {
  getSessionViewerSnapshot,
  subscribeSessionViewer,
} from "../lib/sessionViewerController";
import {
  type ProjectAppView,
  sessionViewViewers,
} from "../lib/sessionViewPublication";
import { useVersion } from "./useVersion";

/** Coalesces a burst of viewer and focus changes into one report. */
const PUBLISH_DELAY_MS = 250;
/** Set once the server refuses this tab's reports, for example a limited user. */
let refused = false;
/** Reports leave in order, so a departure cannot overtake a later return. */
let pending: Promise<unknown> = Promise.resolve();
function enqueue(request: () => Promise<unknown>): Promise<unknown> {
  pending = pending.then(request, request);
  return pending;
}

function refusal(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Report what this tab shows beside the session, so `ya-agent view` can
 * answer which app or file the user has open (topics/agent-self.md § View
 * inspection). Reports only to a server advertising agent-session-view, only
 * for the visible route, and only when the view or focus changed. Leaving the
 * session reports the departure. It subscribes to the viewer store directly,
 * so viewer changes never re-render the session page.
 */
export function useSessionViewPublication(
  sessionId: string,
  active: boolean,
  projectApp: ProjectAppView | null,
): void {
  const { version } = useVersion();
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.agentSessionView,
  );
  const projectAppRef = useRef(projectApp);
  projectAppRef.current = projectApp;
  const scheduleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!supported || !active || refused) return;
    const clientId = browserTabId();
    const device = browserDeviceName();
    let lastSent = "";
    let published = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      timer = undefined;
      if (refused) return;
      const publication = {
        clientId,
        device,
        focused: document.visibilityState === "visible" && document.hasFocus(),
        viewers: sessionViewViewers(
          sessionId,
          getSessionViewerSnapshot(),
          projectAppRef.current,
        ),
      };
      const key = JSON.stringify(publication);
      if (key === lastSent) return;
      lastSent = key;
      published = true;
      enqueue(() => api.publishSessionView(sessionId, publication)).catch(
        (error) => {
          if (refusal(error)) refused = true;
          // A transient failure is retried by the next change.
          else lastSent = "";
        },
      );
    };
    const schedule = () => {
      timer ??= setTimeout(send, PUBLISH_DELAY_MS);
    };
    scheduleRef.current = schedule;
    schedule();
    const unsubscribe = subscribeSessionViewer(schedule);
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      scheduleRef.current = null;
      unsubscribe();
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (timer !== undefined) clearTimeout(timer);
      if (published && !refused)
        enqueue(() => api.departSessionView(sessionId, clientId)).catch(() => {
          // The server keeps the stale report with its age; nothing to repair.
        });
    };
  }, [supported, active, sessionId]);

  const projectAppKey = projectApp ? JSON.stringify(projectApp) : "";
  useEffect(() => {
    void projectAppKey;
    scheduleRef.current?.();
  }, [projectAppKey]);
}
