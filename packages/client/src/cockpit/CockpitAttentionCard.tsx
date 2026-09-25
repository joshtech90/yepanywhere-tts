import { useMemo, useRef, useState } from "react";
import type { InputRequest } from "../types";
import { useI18n } from "../i18n";
import {
  areCockpitQuestionsAnswered,
  createCockpitAttentionDisplay,
  createCockpitQuestionAnswers,
  type CockpitQuestionOtherAnswers,
  type CockpitQuestionSelections,
} from "./core/attention";
import { containCockpitLocalEscape } from "./core/shortcuts";
import type {
  CockpitAttentionActionResult,
  CockpitAttentionPort,
} from "./useCockpitAttention";
import styles from "./CockpitAttentionCard.module.css";

interface CockpitAttentionCardProps {
  request: InputRequest;
  respond: CockpitAttentionPort["respond"];
}

export function CockpitAttentionCard({
  request,
  respond,
}: CockpitAttentionCardProps) {
  const { t } = useI18n();
  const display = useMemo(
    () => createCockpitAttentionDisplay(request),
    [request],
  );
  const inFlightRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] =
    useState<CockpitAttentionActionResult | null>(null);
  const [selections, setSelections] = useState<CockpitQuestionSelections>({});
  const [otherAnswers, setOtherAnswers] =
    useState<CockpitQuestionOtherAnswers>({});
  const settled = result?.kind === "accepted" || result?.kind === "stale";
  const questionsAnswered = areCockpitQuestionsAnswered(
    display.questions,
    selections,
    otherAnswers,
  );

  const submit = async (response: "approve" | "deny") => {
    if (inFlightRef.current || settled) return;
    inFlightRef.current = true;
    setPending(true);
    setResult(null);
    try {
      const answers =
        response === "approve" && display.kind === "question"
          ? createCockpitQuestionAnswers(
              display.questions,
              selections,
              otherAnswers,
            )
          : undefined;
      setResult(await respond(display.requestId, response, answers));
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: contains Escape from the interactive question controls before the global Stop shortcut
    <section
      className={styles.root}
      onKeyDown={(event) => {
        containCockpitLocalEscape(event);
      }}
    >
      <div className={styles.card}>
        <div className={styles.heading}>
          <div className={styles.headingText}>
            <p className={styles.eyebrow}>
              {display.kind === "question"
                ? t("cockpitAttentionQuestionEyebrow")
                : t("cockpitAttentionApprovalEyebrow")}
            </p>
            <h3>
              {display.kind === "question"
                ? t("cockpitAttentionQuestionTitle")
                : t("cockpitAttentionApprovalTitle")}
            </h3>
          </div>
          {display.toolName && (
            <span className={styles.toolName}>{display.toolName}</span>
          )}
        </div>

        <p className={styles.prompt}>{display.prompt}</p>

        {display.kind === "question" && (
          <div className={styles.questions}>
            {display.questions.map((question) => {
              const selected = selections[question.key] ?? [];
              return (
                <fieldset className={styles.question} key={question.key}>
                  <legend>{question.header}</legend>
                  <p className={styles.questionPrompt}>{question.prompt}</p>
                  {question.options.length > 0 && (
                    <div className={styles.options}>
                      {question.options.map((option) => {
                        const pressed = selected.includes(option.value);
                        return (
                          <button
                            aria-pressed={pressed}
                            className={styles.option}
                            disabled={pending || settled}
                            key={option.value}
                            onClick={() => {
                              setSelections((current) => {
                                const currentValues = current[question.key] ?? [];
                                const nextValues = question.multiSelect
                                  ? pressed
                                    ? currentValues.filter(
                                        (value) => value !== option.value,
                                      )
                                    : [...currentValues, option.value]
                                  : [option.value];
                                return {
                                  ...current,
                                  [question.key]: nextValues,
                                };
                              });
                              if (!question.multiSelect) {
                                setOtherAnswers((current) => ({
                                  ...current,
                                  [question.key]: "",
                                }));
                              }
                            }}
                            type="button"
                          >
                            <span className={styles.optionText}>
                              <strong>{option.label}</strong>
                              {option.description && (
                                <span>{option.description}</span>
                              )}
                            </span>
                            <span
                              aria-hidden="true"
                              className={styles.optionMark}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {question.allowsOther && (
                    <label className={styles.otherLabel}>
                      <span>{t("cockpitAttentionOtherAnswer")}</span>
                      <input
                        aria-label={`${question.header}: ${t("cockpitAttentionOtherAnswer")}`}
                        disabled={pending || settled}
                        onChange={(event) => {
                          const value = event.target.value;
                          setOtherAnswers((current) => ({
                            ...current,
                            [question.key]: value,
                          }));
                          if (!question.multiSelect && value) {
                            setSelections((current) => ({
                              ...current,
                              [question.key]: [],
                            }));
                          }
                        }}
                        type={question.secret ? "password" : "text"}
                        value={otherAnswers[question.key] ?? ""}
                      />
                    </label>
                  )}
                </fieldset>
              );
            })}
          </div>
        )}

        {display.kind === "approval" && display.inputPreview && (
          <details className={styles.details}>
            <summary>{t("cockpitAttentionDetails")}</summary>
            <pre>{display.inputPreview}</pre>
          </details>
        )}

        <div className={styles.actions}>
          <button
            className={styles.secondaryAction}
            disabled={pending || settled}
            onClick={() => void submit("deny")}
            type="button"
          >
            {display.kind === "question"
              ? t("cockpitAttentionCancel")
              : t("cockpitAttentionReject")}
          </button>
          <button
            className={styles.primaryAction}
            disabled={
              pending ||
              settled ||
              (display.kind === "question" && !questionsAnswered)
            }
            onClick={() => void submit("approve")}
            type="button"
          >
            {pending
              ? t("cockpitAttentionPending")
              : display.kind === "question"
                ? t("cockpitAttentionAnswer")
                : t("cockpitAttentionApprove")}
          </button>
        </div>

        {result && (
          <p className={styles.result} data-kind={result.kind} role="status">
            {result.kind === "accepted"
              ? t("cockpitAttentionAccepted")
              : result.kind === "stale"
                ? t("cockpitAttentionStale")
                : t("cockpitAttentionFailed", {
                    message:
                      result.message || t("cockpitAttentionUnknownError"),
                  })}
          </p>
        )}
      </div>
    </section>
  );
}
