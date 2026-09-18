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
      await api.markSessionSeen(options.sessionId!, undefined, target, target);
    },
    onError: (kind) =>
      options.onError(kind === "completion" ? "acknowledgement" : kind),
  });
}
