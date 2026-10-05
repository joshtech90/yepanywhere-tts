import { useI18n } from "../i18n";
import type { GitFailureDescription } from "../lib/gitActionError";
import { CopyButton } from "./CopyButton";
import styles from "./GitActionFeedback.module.css";

export function GitActionFeedback({
  message,
  tone,
  failure,
}: {
  message: string;
  tone: "success" | "warning";
  failure: GitFailureDescription | null;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`${styles.message} ${tone === "warning" ? styles.warning : styles.success}`}
      role={tone === "warning" ? "alert" : "status"}
    >
      <div>{message}</div>
      {failure?.hint && <p className={styles.hint}>{failure.hint}</p>}
      {failure?.detail && (
        <details key={failure.detail} className={styles.details}>
          <summary>{t("gitStatusErrorDetails")}</summary>
          <div className={styles.output}>
            <CopyButton
              value={failure.detail}
              title={t("gitStatusCopyErrorDetails")}
              className={styles.copy}
            />
            <pre>{failure.detail}</pre>
          </div>
        </details>
      )}
    </div>
  );
}
