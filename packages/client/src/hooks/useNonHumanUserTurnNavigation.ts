import {
  NON_HUMAN_USER_TURN_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useVersion } from "./useVersion";
import {
  useSessionMessageNavigation,
  type MessageNavigationOptions,
} from "./useSessionMessageNavigation";

type NavigationOptions = Omit<
  MessageNavigationOptions,
  "target" | "enabled" | "onResolved" | "onError"
> & {
  onError(kind: "unavailable" | "acknowledgement"): void;
};

export function useNonHumanUserTurnNavigation(options: NavigationOptions) {
  const location = useLocation();
  const { version } = useVersion();
  useSessionMessageNavigation({
    ...options,
    target: new URLSearchParams(location.search).get("nonHumanTurn"),
    enabled: serverHasCapability(version, NON_HUMAN_USER_TURN_CAPABILITY),
    onResolved: async (target) => {
      const seen = await api.markSessionSeen(
        options.sessionId!,
        undefined,
        target,
        target,
      );
      // The server keeps a receipt it could not match, so a false answer is
      // the acknowledgement failure this hook reports.
      if (seen.acknowledged === false) {
        throw new Error(`Delivered turn ${target} was not acknowledged`);
      }
    },
    onError: (kind) =>
      options.onError(kind === "completion" ? "acknowledgement" : kind),
  });
}
