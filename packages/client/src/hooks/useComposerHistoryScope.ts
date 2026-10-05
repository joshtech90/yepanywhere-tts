import { useClientSummarySourceKey } from "../lib/clientSummarySourceKey";
import { useActingPrincipal } from "./useActingPrincipal";

export function useComposerHistoryScope(): string | null {
  const sourceKey = useClientSummarySourceKey();
  const { principal, resolved } = useActingPrincipal();
  return resolved ? JSON.stringify([sourceKey, principal.username]) : null;
}
