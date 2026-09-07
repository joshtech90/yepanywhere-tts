import { useId, useState } from "react";
import { useI18n } from "../i18n";
import styles from "./QuestionAsideCard.module.css";

export interface QuestionAsideCardProps {
  question: string;
  answers: readonly string[];
  status: "starting" | "running" | "complete" | "failed" | "saving";
  error?: string;
  onSave: () => void;
  onDiscard: () => void;
}

export function QuestionAsideHint({ mobile }: { mobile: boolean }) {
  const { t } = useI18n();
  return (
    <div className={styles.hint} role="status">
      {t(mobile ? "questionAsideHintMobile" : "questionAsideHintDesktop")}
    </div>
  );
}

export function QuestionAsideCard({
  question,
  answers,
  status,
  error,
  onSave,
  onDiscard,
}: QuestionAsideCardProps) {
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const complete = status === "complete" && answers.length > 0;
  const saving = status === "saving";
  return (
    <section
      className={styles.card}
      aria-label={t("questionAsideTitle")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setHelpOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && helpOpen) {
          event.preventDefault();
          event.stopPropagation();
          setHelpOpen(false);
        }
      }}
    >
      <div className={styles.content}>
        <div className={styles.question}>{question}</div>
        {answers.map((text, index) => (
          <div key={`${index}:${text.length}`} className={styles.answer}>
            {text}
          </div>
        ))}
        {(status === "starting" || status === "running") && (
          <div className={styles.status} role="status">
            {t("questionAsideAnswering")}
          </div>
        )}
        {error && (
          <div className={styles.status} role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className={styles.actions}>
        <button
          className={styles.save}
          type="button"
          aria-label={t(saving ? "questionAsideSaving" : "questionAsideSave")}
          disabled={!complete || saving}
          onClick={onSave}
          title={t("questionAsideSaveShortcut")}
        >
          {t(saving ? "questionAsideSaving" : "questionAsideSave")}
        </button>
        <kbd title={t("questionAsideSaveShortcut")}>↵</kbd>
        <button
          className={styles.discard}
          type="button"
          aria-label={t("questionAsideDiscard")}
          disabled={saving}
          onClick={onDiscard}
        >
          {t("questionAsideDiscard")}
          <kbd>Esc</kbd>
        </button>
        <button
          className={styles.help}
          type="button"
          aria-label={t("questionAsideTitle")}
          aria-expanded={helpOpen}
          aria-controls={helpId}
          title={
            helpOpen
              ? undefined
              : `${t("questionAsideTitle")}. ${t("questionAsideMainComposer")}. ${t("questionAsideSaveDescription")}`
          }
          onClick={() => setHelpOpen(!helpOpen)}
        >
          ?
        </button>
        {helpOpen && (
          <div id={helpId} className={styles.helpContent} role="tooltip">
            <strong>{t("questionAsideTitle")}</strong>
            <p>
              {t("questionAsideMainComposer")}.{" "}
              {t("questionAsideSaveDescription")}
            </p>
            <p>{t("questionAsideSaveShortcut")}</p>
          </div>
        )}
      </footer>
    </section>
  );
}
