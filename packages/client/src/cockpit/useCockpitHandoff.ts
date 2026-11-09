import type {
  ProviderName,
  SessionCreationReceipt,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useI18n } from "../i18n";
import { createSessionNavigationState } from "../lib/sessionNavigationState";
import { generateUUID } from "../lib/uuid";
import { sendCockpitDirectMessage } from "./cockpitSend";
import {
  buildCockpitHandoffMessage,
  COCKPIT_HANDOFF_PROMPT,
  extractCockpitHandoffSummary,
} from "./core/handoff";
import { createCockpitNavigation } from "./core/navigation";
import {
  isFinalCreationRefusal,
  requestCockpitSessionCreation,
} from "./core/sessionCreation";
import { type CockpitLaunchChoices, launchOptions } from "./core/newSession";
import type { CockpitTranscriptEntry } from "./core/sessionDetail";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";

/** How long a finished turn may take to show its answer in the transcript. */
export const COCKPIT_HANDOFF_SUMMARY_WAIT_MS = 20_000;

export type CockpitHandoffPhase = "idle" | "summarizing" | "starting" | "error";

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
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [error, setError] = useState<string | null>(null);
  const choicesRef = useRef<CockpitLaunchChoices | null>(null);
  const sawTurnRef = useRef(false);
  /**
   * A handoff creation the host never answered. A retry writes a new summary,
   * so it cannot reuse the request; it first asks whether the earlier one was
   * saved and opens that session instead of starting a second one.
   */
  const unconfirmedRef = useRef<{
    sourceKey: string;
    projectId: string;
    requestId: string;
  } | null>(null);
  // Set before the first await so a second click cannot start a second run.
  const inFlightRef = useRef(false);
  const [waitExpired, setWaitExpired] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fail = useCallback((message: string) => {
    inFlightRef.current = false;
    if (!mountedRef.current) return;
    setError(message);
    setPhase("error");
  }, []);

  const start = useCallback(
    async (choices: CockpitLaunchChoices) => {
      if (inFlightRef.current) return;
      // Never write into a transcript another program or a running turn owns.
      if (port.status.owner === "external" || port.processState !== "idle") {
        fail(t("cockpitQuickHandoffBusy"));
        return;
      }
      inFlightRef.current = true;
      choicesRef.current = choices;
      sawTurnRef.current = false;
      setWaitExpired(false);
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
              sendError instanceof Error
                ? sendError.message
                : String(sendError),
          }),
        );
      }
    },
    [fail, port, projectId, runtime.transport, t],
  );

  // The summary is ready once the turn that answers the prompt has ended.
  useEffect(() => {
    if (phase !== "summarizing") return;
    if (port.processState !== "idle") {
      sawTurnRef.current = true;
      return;
    }
    if (!sawTurnRef.current) {
      if (waitExpired) fail(t("cockpitHandoffNoSummary"));
      return;
    }
    const summary = extractCockpitHandoffSummary(entries);
    const choices = choicesRef.current;
    if (!summary || !choices) {
      // The process can report idle before the final transcript rows land.
      if (waitExpired) fail(t("cockpitHandoffNoSummary"));
      return;
    }
    setPhase("starting");
    const message = buildCockpitHandoffMessage({ summary, sourceTitle });
    const transport = runtime.transport;
    const sourceKey = runtime.sourceKey;
    const create = async (): Promise<SessionCreationReceipt> => {
      const earlier = unconfirmedRef.current;
      if (earlier?.sourceKey === sourceKey && earlier.projectId === projectId) {
        const saved = await transport
          .fetch<SessionCreationReceipt>(
            `/session-creations/${encodeURIComponent(earlier.requestId)}`,
          )
          .catch(() => null);
        if (saved?.requestId === earlier.requestId && saved.sessionId) {
          unconfirmedRef.current = null;
          return saved;
        }
      }
      const requestId = generateUUID();
      unconfirmedRef.current = { sourceKey, projectId, requestId };
      try {
        const receipt = await requestCockpitSessionCreation(
          transport,
          projectId,
          {
            requestId,
            message,
            options: {
              ...launchOptions(choices),
              ...(choices.supportsPermissionMode
                ? { mode: port.permissionMode }
                : {}),
            },
            clientTimestamp: Date.now(),
          },
        );
        unconfirmedRef.current = null;
        return receipt;
      } catch (error) {
        if (isFinalCreationRefusal(error)) unconfirmedRef.current = null;
        throw error;
      }
    };
    void create()
      .then((result) => {
        if (!mountedRef.current) return;
        const navigation = createCockpitNavigation(basePath);
        navigate(navigation.session(result.projectId, result.sessionId), {
          state: createSessionNavigationState({
            initialTitle: t("cockpitHandoffNewTitle", { title: sourceTitle }),
            initialModel: choices.effective.model ?? undefined,
            initialProvider:
              (result.provider as ProviderName | undefined) ??
              choices.effective.provider ??
              undefined,
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
    runtime.sourceKey,
    runtime.transport,
    sourceTitle,
    t,
    waitExpired,
  ]);

  const turnEnded = phase === "summarizing" && port.processState === "idle";
  useEffect(() => {
    if (!turnEnded) return;
    const timer = setTimeout(
      () => setWaitExpired(true),
      COCKPIT_HANDOFF_SUMMARY_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [turnEnded]);

  const reset = useCallback(() => {
    // Once the new session is being created there is nothing left to cancel.
    if (phaseRef.current === "starting") return;
    inFlightRef.current = false;
    choicesRef.current = null;
    sawTurnRef.current = false;
    setWaitExpired(false);
    setError(null);
    setPhase("idle");
  }, []);

  return { phase, error, start, reset };
}
