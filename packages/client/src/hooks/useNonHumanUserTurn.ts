import {
  NON_HUMAN_USER_TURN_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useSessionCollectionRecord } from "../lib/clientSummaryStore";
import { useVersion } from "./useVersion";

export function useNonHumanUserTurn(sessionId: string) {
  const { version } = useVersion();
  const row = useSessionCollectionRecord(sessionId);
  return serverHasCapability(version, NON_HUMAN_USER_TURN_CAPABILITY)
    ? row?.nonHumanUserTurn
    : undefined;
}
