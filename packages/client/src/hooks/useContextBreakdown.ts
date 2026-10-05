import {
  type ContextBreakdown,
  SERVER_CAPABILITIES,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useVersion } from "./useVersion";

export type ContextBreakdownState =
  | { status: "loading" }
  | { status: "loaded"; breakdown: ContextBreakdown }
  /** No live process, or its provider reports no breakdown: render nothing. */
  | { status: "absent" }
  | { status: "error"; message: string };

/**
 * Fetch the session's context breakdown each time `active` turns on, so an
 * open popover shows the window as it is now. Returns null when nothing should
 * render: no session, popover closed, or a server without the route (which is
 * then never asked).
 */
export function useContextBreakdown(
  sessionId: string | undefined,
  active: boolean,
): ContextBreakdownState | null {
  const { version } = useVersion();
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.contextUsageBreakdown,
  );
  const enabled = active && supported && !!sessionId;
  const [state, setState] = useState<ContextBreakdownState | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setState(null);
      return;
    }
    let current = true;
    setState({ status: "loading" });
    api.getSessionContextBreakdown(sessionId).then(
      ({ breakdown }) => {
        if (!current) return;
        setState(
          breakdown ? { status: "loaded", breakdown } : { status: "absent" },
        );
      },
      (error: unknown) => {
        if (!current) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      current = false;
    };
  }, [enabled, sessionId]);

  return enabled ? state : null;
}
