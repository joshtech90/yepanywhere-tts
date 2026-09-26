import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuestionAnswerPanel } from "../components/QuestionAnswerPanel";
import { ToolApprovalPanel } from "../components/ToolApprovalPanel";
import { useI18n, type TranslationFn } from "../i18n";
import type { InputRequest, UserQuestionAnswers } from "../types";
import styles from "./CockpitPendingInput.module.css";

type InputResponse = "approve" | "approve_accept_edits" | "deny";
export type CockpitInputNotice = "accepted" | "stale";

interface CockpitPendingInputProps {
  onNotice: (notice: CockpitInputNotice) => void;
  onRefresh: () => Promise<InputRequest | null>;
  onRespond: (
    requestId: string,
    response: InputResponse,
    answers?: UserQuestionAnswers,
    feedback?: string,
  ) => Promise<void>;
  reconnecting: boolean;
  request: InputRequest;
  sessionId: string;
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isQuestionRequest(request: InputRequest): boolean {
  return (
    request.toolName === "AskUserQuestion" ||
    request.type === "question" ||
    request.type === "choice"
  );
}

function hasStructuredQuestions(request: InputRequest): boolean {
  if (!request.toolInput || typeof request.toolInput !== "object") return false;
  const questions = Reflect.get(request.toolInput, "questions");
  return Array.isArray(questions) && questions.length > 0;
}

function normalizeQuestionRequest(
  request: InputRequest,
  t: TranslationFn,
): InputRequest {
  if (hasStructuredQuestions(request)) return request;
  return {
    ...request,
    toolInput: {
      questions: [
        {
          id: request.id,
          question: request.prompt,
          header: t("cockpitSessionQuestion"),
          options: (request.options ?? []).map((label) => ({
            label,
            description: "",
          })),
          multiSelect: false,
          isOther: true,
        },
      ],
    },
  };
}

export function CockpitPendingInput({
  onNotice,
  onRefresh,
  onRespond,
  reconnecting,
  request,
  sessionId,
}: CockpitPendingInputProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const questionRequest = useMemo(
    () => normalizeQuestionRequest(request, t),
    [request, t],
  );

  useEffect(() => {
    activeRequestRef.current = null;
    setPending(false);
    setError(null);
  }, [request.id]);

  const respond = useCallback(
    async (
      response: InputResponse,
      answers?: UserQuestionAnswers,
      feedback?: string,
    ) => {
      if (activeRequestRef.current !== null) return;
      activeRequestRef.current = request.id;
      setPending(true);
      setError(null);
      try {
        await onRespond(request.id, response, answers, feedback);
        onNotice("accepted");
      } catch (responseError) {
        const status = errorStatus(responseError);
        if (status === 400 || status === 404) {
          try {
            const currentRequest = await onRefresh();
            if (currentRequest?.id === request.id) {
              setError(t("cockpitSessionInputRejected"));
            } else {
              onNotice("stale");
              setError(t("cockpitSessionInputStale"));
            }
          } catch (refreshError) {
            setError(
              t("cockpitSessionInputFailed", {
                message: errorMessage(refreshError),
              }),
            );
          }
        } else {
          setError(
            t("cockpitSessionInputFailed", {
              message: errorMessage(responseError),
            }),
          );
        }
      } finally {
        if (activeRequestRef.current === request.id) {
          activeRequestRef.current = null;
          setPending(false);
        }
      }
    },
    [onNotice, onRefresh, onRespond, request.id, t],
  );

  return (
    <section
      aria-busy={pending}
      aria-label={t("cockpitSessionInputNeeded")}
      className={styles.root}
      data-state={pending ? "pending" : error ? "error" : "ready"}
    >
      <div className={styles.statusRow}>
        <strong>{t("cockpitSessionInputNeeded")}</strong>
        {pending && (
          <span role="status">{t("cockpitSessionInputSending")}</span>
        )}
        {!pending && reconnecting && (
          <span role="status">{t("cockpitSessionInputReconnecting")}</span>
        )}
      </div>

      {isQuestionRequest(request) ? (
        <QuestionAnswerPanel
          onDeny={() => respond("deny")}
          onSubmit={(answers) => respond("approve", answers)}
          request={questionRequest}
          sessionId={sessionId}
        />
      ) : (
        <ToolApprovalPanel
          onApprove={() => respond("approve")}
          onApproveAcceptEdits={() => respond("approve_accept_edits")}
          onDeny={() => respond("deny")}
          onDenyWithFeedback={(feedback) =>
            respond("deny", undefined, feedback)
          }
          projectPath={null}
          request={request}
          sessionId={sessionId}
        />
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
