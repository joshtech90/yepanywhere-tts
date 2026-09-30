import { useCallback, useEffect, useState } from "react";
import type { ProviderInfo } from "@yep-anywhere/shared";
import {
  type LiveThinkingSelection,
  liveThinkingSelectionFromProcess,
  thinkingOptionFromSelection,
} from "../lib/liveThinkingConfig";
import type { SessionModelConfig } from "../lib/sessionModelConfig";

/** A stopped-session edit belongs to its next turn, never to global defaults. */
export function useSessionThinkingSelection(
  sessionKey: string,
  owned: boolean,
  config: SessionModelConfig | null,
  provider?: ProviderInfo | null,
) {
  const [pending, setPending] = useState<{
    sessionKey: string;
    selection: LiveThinkingSelection;
  } | null>(null);
  useEffect(() => {
    // Either transition starts a new lifetime for the stopped-session override.
    void sessionKey;
    void owned;
    setPending(null);
  }, [sessionKey, owned]);
  const override =
    !owned && pending?.sessionKey === sessionKey ? pending.selection : null;
  const selection =
    override ??
    (config
      ? liveThinkingSelectionFromProcess(
          config.thinking,
          config.effort,
          provider,
        )
      : null);
  const setStoppedSelection = useCallback(
    (value: LiveThinkingSelection) =>
      setPending({ sessionKey, selection: value }),
    [sessionKey],
  );
  return {
    selection,
    thinkingOverride: override
      ? thinkingOptionFromSelection(override.mode, override.effortLevel)
      : undefined,
    setStoppedSelection,
  };
}
