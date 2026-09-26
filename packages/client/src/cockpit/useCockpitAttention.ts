import type { UserQuestionAnswers } from "@yep-anywhere/shared";
import { useCallback, useRef } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
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
  const runtime = useCurrentSourceRuntime();
  const currentRequestRef = useRef(pendingInputRequest);
  const currentProcessIdRef = useRef<string | undefined>(undefined);
  const currentTransportRef = useRef(runtime.transport);
  currentRequestRef.current = pendingInputRequest;
  currentTransportRef.current = runtime.transport;
  const respond = useCallback<CockpitAttentionPort["respond"]>(
    async (requestId, response, answers) => {
      const request = pendingInputRequest;
      if (!request || request.id !== requestId) return { kind: "stale" };
      const transport = runtime.transport;
      const isCurrentRequest = () => {
        const currentRequest = currentRequestRef.current;
        return (
          currentRequest?.id === requestId &&
          currentRequest.sessionId === request.sessionId &&
          currentTransportRef.current === transport
        );
      };

      try {
        const result = await transport.fetch<{
          accepted: boolean;
          pendingInputRequest?: InputRequest | null;
        }>(`/sessions/${request.sessionId}/input`, {
          method: "POST",
          body: JSON.stringify({ requestId, response, answers }),
        });
        if (!result.accepted) {
          return { kind: "error", message: "" };
        }
        if (!isCurrentRequest()) return { kind: "stale" };
        setPendingInputRequest(result.pendingInputRequest ?? null);
        return { kind: "accepted" };
      } catch (error) {
        const status = errorStatus(error);
        if (status !== 400 && status !== 404) {
          return { kind: "error", message: errorMessage(error) };
        }
        if (!isCurrentRequest()) return { kind: "stale" };

        try {
          const refreshed = await transport.fetch<{
            request: InputRequest | null;
          }>(`/sessions/${request.sessionId}/pending-input`);
          if (isCurrentRequest()) {
            setPendingInputRequest(refreshed.request ?? null);
          }
        } catch {
          // A 400/404 already proves this exact request is no longer actionable.
          // Reconnect or the next session event remains the state authority.
        }
        return { kind: "stale" };
      }
    },
    [pendingInputRequest, runtime.transport, setPendingInputRequest],
  );

  const processId = status.owner === "self" ? status.processId : undefined;
  currentProcessIdRef.current = processId;
  const interruptible =
    typeof processId === "string" &&
    processId.length > 0 &&
    processState !== "idle";

  const stop = useCallback<CockpitAttentionPort["stop"]>(async () => {
    if (!processId || processState === "idle") return { kind: "stale" };
    const transport = runtime.transport;
    const isCurrentProcess = () =>
      currentProcessIdRef.current === processId &&
      currentTransportRef.current === transport;

    try {
      const interrupted = await transport.fetch<{
        aborted?: boolean;
        interrupted: boolean;
        supported: boolean;
      }>(`/processes/${processId}/interrupt`, { method: "POST" });
      if (interrupted.interrupted && !interrupted.aborted) {
        return { kind: "accepted" };
      }
      if (!interrupted.aborted) {
        await transport.fetch(`/processes/${processId}/abort`, {
          method: "POST",
        });
      }
      if (isCurrentProcess()) {
        setStatus({ owner: "none" });
        setProcessState("idle");
      }
      return { kind: "accepted" };
    } catch (interruptError) {
      try {
        await transport.fetch(`/processes/${processId}/abort`, {
          method: "POST",
        });
        if (isCurrentProcess()) {
          setStatus({ owner: "none" });
          setProcessState("idle");
        }
        return { kind: "accepted" };
      } catch (abortError) {
        if (errorStatus(abortError) === 404) {
          if (isCurrentProcess()) {
            setStatus({ owner: "none" });
            setProcessState("idle");
          }
          return { kind: "stale" };
        }
        return {
          kind: "error",
          message: errorMessage(abortError ?? interruptError),
        };
      }
    }
  }, [processId, processState, runtime.transport, setProcessState, setStatus]);

  return {
    interruptible,
    request: pendingInputRequest,
    respond,
    stop,
  };
}
