import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useI18n } from "../i18n";
import { createSessionNavigationState } from "../lib/sessionNavigationState";
import { sendCockpitDirectMessage } from "./cockpitSend";
import {
  buildCockpitHandoffMessage,
  COCKPIT_HANDOFF_PROMPT,
  extractCockpitHandoffSummary,
} from "./core/handoff";
import { createCockpitNavigation } from "./core/navigation";
import { type CockpitLaunchChoices, launchOptions } from "./core/newSession";
import type { CockpitTranscriptEntry } from "./core/sessionDetail";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";

export type CockpitHandoffPhase =
  | "idle"
  | "summarizing"
  | "starting"
  | "error";

export interface CockpitHandoff {
  phase: CockpitHandoffPhase;
  error: string | null;
  start: (choices: CockpitLaunchChoices) => Promise<void>;
  reset: () => void;
}

/**
 * Handoff to a new session: the current session writes its own summary on a
 * fixed prompt, then a new session in the same project starts with it. Every
 * step uses the composer's send path and the regular session start.
 */
export function useCockpitHandoff({
  basePath,
  entries,
  port,
  projectId,
  sourceTitle,
}: {
  basePath: string;
  entries: readonly CockpitTranscriptEntry[];
  port: CockpitComposerSessionPort;
  projectId: string;
  sourceTitle: string;
}): CockpitHandoff {
  const { t } = useI18n();
  const runtime = useCurrentSourceRuntime();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<CockpitHandoffPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const choicesRef = useRef<CockpitLaunchChoices | null>(null);
  const sawTurnRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fail = useCallback((message: string) => {
    if (!mountedRef.current) return;
    setError(message);
    setPhase("error");
  }, []);

  const start = useCallback(
    async (choices: CockpitLaunchChoices) => {
      if (phase === "summarizing" || phase === "starting") return;
      choicesRef.current = choices;
      sawTurnRef.current = false;
      setError(null);
      setPhase("summarizing");
      const submittedAt = new Date().toISOString();
      const previousProcessState = port.processState;
      const { tempId } = port.addPendingMessage(
        COCKPIT_HANDOFF_PROMPT,
        undefined,
        submittedAt,
      );
      port.setProcessState("in-turn");
      try {
        await sendCockpitDirectMessage({
          transport: runtime.transport,
          projectId,
          port,
          text: COCKPIT_HANDOFF_PROMPT,
          tempId,
          submittedAt,
        });
      } catch (sendError) {
        port.removePendingMessage(tempId);
        port.setProcessState(previousProcessState);
        fail(
          t("cockpitHandoffSendFailed", {
            message:
              sendError instanceof Error ? sendError.message : String(sendError),
          }),
        );
      }
    },
    [fail, phase, port, projectId, runtime.transport, t],
  );

  // The summary is ready once the turn that answers the prompt has ended.
  useEffect(() => {
    if (phase !== "summarizing") return;
    if (port.processState !== "idle") {
      sawTurnRef.current = true;
      return;
    }
    if (!sawTurnRef.current) return;
    const summary = extractCockpitHandoffSummary(entries);
    const choices = choicesRef.current;
    if (!summary || !choices) {
      fail(t("cockpitHandoffNoSummary"));
      return;
    }
    setPhase("starting");
    const message = buildCockpitHandoffMessage({ summary, sourceTitle });
    void api
      .startSession(
        projectId,
        message,
        {
          ...launchOptions(choices),
          ...(choices.supportsPermissionMode
            ? { mode: port.permissionMode }
            : {}),
        },
        undefined,
        Date.now(),
      )
      .then((result) => {
        if (!mountedRef.current) return;
        const navigation = createCockpitNavigation(basePath);
        navigate(navigation.session(result.projectId, result.sessionId), {
          state: createSessionNavigationState({
            initialStatus: {
              owner: "self",
              processId: result.processId,
              permissionMode: result.permissionMode,
              appliedPermissionMode: result.appliedPermissionMode,
              modeVersion: result.modeVersion,
              recapAfterSeconds: result.recapAfterSeconds,
            },
            initialTitle: t("cockpitHandoffNewTitle", { title: sourceTitle }),
            initialModel:
              result.model ?? choices.effective.model ?? undefined,
            initialProvider:
              result.provider ?? choices.effective.provider ?? undefined,
          }),
        });
      })
      .catch((startError: unknown) =>
        fail(
          startError instanceof Error && startError.message
            ? startError.message
            : t("newSessionStartError"),
        ),
      );
  }, [
    basePath,
    entries,
    fail,
    navigate,
    phase,
    port.permissionMode,
    port.processState,
    projectId,
    sourceTitle,
    t,
  ]);

  const reset = useCallback(() => {
    if (phase === "summarizing" || phase === "starting") return;
    setError(null);
    setPhase("idle");
  }, [phase]);

  return { phase, error, start, reset };
}
