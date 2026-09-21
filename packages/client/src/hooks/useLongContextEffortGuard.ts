import {
  effortOfThinkingOption,
  shouldWarnLongContextEffortChange,
  type EffortLevel,
  type LongContextEffortWarningSettings,
  type ProviderInfo,
  type ProviderName,
  type ThinkingOption,
} from "@yep-anywhere/shared";
import { useCallback, useRef, useState } from "react";
import { api } from "../api/client";
import type { LongContextEffortWarningChoice } from "../components/LongContextEffortWarningModal";
import { getEffortLevelLabel, isEffortLevel } from "../lib/effortLevels";

export type LongContextEffortGuardVerdict = "apply" | "skip";

export interface LongContextEffortGuardInput {
  provider: ProviderName | undefined;
  providerInfo?: ProviderInfo | null;
  model: string | undefined;
  /** Prompt size of the session's last provider request, in tokens. */
  contextTokens: number | undefined;
  settings: LongContextEffortWarningSettings | null | undefined;
  /** Whether the session can be forked right now (provider support, idle). */
  canFork: boolean;
  /** Runs the fork with the chosen effort and navigates to it. */
  forkWithThinking: (thinking: ThinkingOption) => Promise<void>;
  /** Translates the effort labels shown in the dialog. */
  translateEffort: Parameters<typeof getEffortLevelLabel>[2];
  /** Label for an option with no explicit effort (auto or off). */
  noEffortLabel: string;
}

export interface LongContextEffortWarningState {
  provider: ProviderName;
  contextTokens: number;
  currentEffortLabel: string;
  nextEffortLabel: string;
  canFork: boolean;
  busy: boolean;
}

/**
 * Gate for mid-session effort changes: when the change would re-read a long
 * cached prompt, ask before applying and offer a fork at the new effort
 * instead. Resolves `apply` when the caller should proceed with the change,
 * `skip` when the user cancelled or chose the fork (which this hook runs).
 * Contract: topics/mid-session-effort-change.md.
 */
export function useLongContextEffortGuard(input: LongContextEffortGuardInput) {
  const [warning, setWarning] = useState<LongContextEffortWarningState | null>(
    null,
  );
  const pendingRef = useRef<{
    resolve: (verdict: LongContextEffortGuardVerdict) => void;
    nextThinking: ThinkingOption;
  } | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const effortLabel = useCallback(
    (option: ThinkingOption | undefined): string => {
      const { provider, providerInfo, translateEffort, noEffortLabel } =
        inputRef.current;
      const effort = effortOfThinkingOption(option);
      if (!isEffortLevel(effort)) return noEffortLabel;
      return getEffortLevelLabel(
        effort as EffortLevel,
        providerInfo ?? provider ?? null,
        translateEffort,
      );
    },
    [],
  );

  const guardEffortChange = useCallback(
    (
      nextThinking: ThinkingOption,
      currentThinking: ThinkingOption | undefined,
    ): Promise<LongContextEffortGuardVerdict> => {
      const current = inputRef.current;
      if (
        !current.provider ||
        !shouldWarnLongContextEffortChange({
          provider: current.provider,
          model: current.model,
          contextTokens: current.contextTokens,
          currentThinking,
          nextThinking,
          settings: current.settings,
        })
      ) {
        return Promise.resolve("apply");
      }
      // A second request while one is open supersedes it as a cancel.
      pendingRef.current?.resolve("skip");
      return new Promise((resolve) => {
        pendingRef.current = { resolve, nextThinking };
        setWarning({
          provider: current.provider as ProviderName,
          contextTokens: current.contextTokens ?? 0,
          currentEffortLabel: effortLabel(currentThinking),
          nextEffortLabel: effortLabel(nextThinking),
          canFork: current.canFork,
          busy: false,
        });
      });
    },
    [effortLabel],
  );

  const choose = useCallback(async (choice: LongContextEffortWarningChoice) => {
    const pending = pendingRef.current;
    if (!pending) {
      setWarning(null);
      return;
    }
    if (choice === "apply") {
      pendingRef.current = null;
      setWarning(null);
      pending.resolve("apply");
      return;
    }
    if (choice === "cancel") {
      pendingRef.current = null;
      setWarning(null);
      pending.resolve("skip");
      return;
    }
    setWarning((prev) => (prev ? { ...prev, busy: true } : prev));
    try {
      await inputRef.current.forkWithThinking(pending.nextThinking);
    } finally {
      pendingRef.current = null;
      setWarning(null);
      pending.resolve("skip");
    }
  }, []);

  return { guardEffortChange, warning, choose };
}

/** The fork request the guard's fork choice sends. */
export function forkSessionAtEffort(
  projectId: string,
  sessionId: string,
  thinking: ThinkingOption,
) {
  return api.forkSession(projectId, sessionId, {
    forkKind: "clone-latest-complete",
    thinking,
  });
}
