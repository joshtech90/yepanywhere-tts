import type { UserQuestionAnswers } from "@yep-anywhere/shared";
import { useCallback } from "react";
import { api } from "../api/client";
import type { InputRequest, SessionStatus } from "../types";

export type CockpitAttentionActionResult =
  | { kind: "accepted" }
  | { kind: "stale" }
  | { kind: "error"; message: string };

export interface CockpitAttentionPort {
  interruptible: boolean;
  request: InputRequest | null;
  respond: (
    requestId: string,
    response: "approve" | "deny",
    answers?: UserQuestionAnswers,
  ) => Promise<CockpitAttentionActionResult>;
  stop: () => Promise<CockpitAttentionActionResult>;
}

interface CockpitAttentionInput {
  pendingInputRequest: InputRequest | null;
  processState: "idle" | "in-turn" | "waiting-input";
  setPendingInputRequest: (request: InputRequest | null) => void;
  setProcessState: (state: "idle" | "in-turn" | "waiting-input") => void;
  setStatus: (status: SessionStatus) => void;
  status: SessionStatus;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "";
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined;
}

export function useCockpitAttention({
  pendingInputRequest,
  processState,
  setPendingInputRequest,
  setProcessState,
  setStatus,
  status,
}: CockpitAttentionInput): CockpitAttentionPort {
  const respond = useCallback<CockpitAttentionPort["respond"]>(
    async (requestId, response, answers) => {
      const request = pendingInputRequest;
      if (!request || request.id !== requestId) return { kind: "stale" };

      try {
        const result = await api.respondToInput(
          request.sessionId,
          requestId,
          response,
          answers,
        );
        if (!result.accepted) {
          return { kind: "error", message: "" };
        }
        setPendingInputRequest(result.pendingInputRequest ?? null);
        return { kind: "accepted" };
      } catch (error) {
        if (errorStatus(error) !== 400) {
          return { kind: "error", message: errorMessage(error) };
        }

        try {
          const refreshed = await api.getPendingInputRequest(request.sessionId);
          setPendingInputRequest(refreshed.request ?? null);
        } catch {
          // A 400 already proves this exact request is no longer actionable.
          // Reconnect or the next session event remains the state authority.
        }
        return { kind: "stale" };
      }
    },
    [pendingInputRequest, setPendingInputRequest],
  );

  const processId = status.owner === "self" ? status.processId : undefined;
  const interruptible =
    typeof processId === "string" &&
    processId.length > 0 &&
    processState !== "idle";

  const stop = useCallback<CockpitAttentionPort["stop"]>(async () => {
    if (!processId || processState === "idle") return { kind: "stale" };

    try {
      const interrupted = await api.interruptProcess(processId);
      if (interrupted.interrupted && !interrupted.aborted) {
        return { kind: "accepted" };
      }
      if (!interrupted.aborted) {
        await api.abortProcess(processId);
      }
      setStatus({ owner: "none" });
      setProcessState("idle");
      return { kind: "accepted" };
    } catch (interruptError) {
      try {
        await api.abortProcess(processId);
        setStatus({ owner: "none" });
        setProcessState("idle");
        return { kind: "accepted" };
      } catch (abortError) {
        return {
          kind: "error",
          message: errorMessage(abortError ?? interruptError),
        };
      }
    }
  }, [processId, processState, setProcessState, setStatus]);

  return {
    interruptible,
    request: pendingInputRequest,
    respond,
    stop,
  };
}
