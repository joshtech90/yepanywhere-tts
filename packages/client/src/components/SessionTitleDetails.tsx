import { useState } from "react";
import { useI18n } from "../i18n";
import { writeClipboardText } from "../lib/clipboard";
import styles from "./SessionTitleDetails.module.css";

/** The complete, selectable title shared by Session Info and recent sessions. */
export function SessionTitleDetails({
  title,
  label,
  singleLine = false,
  showCopy = true,
}: {
  title: string;
  label: string;
  singleLine?: boolean;
  showCopy?: boolean;
}) {
  const { t } = useI18n();
  const [copyResult, setCopyResult] = useState<{
    title: string;
    success: boolean;
  } | null>(null);
  const result = copyResult?.title === title ? copyResult : null;

  return (
    <section className={styles.root} aria-label={label}>
      <div className={styles.heading}>
        <h3 className={styles.label}>{label}</h3>
        {showCopy && (
          <button
            type="button"
            className={styles.copy}
            onClick={async () => {
              const success = await writeClipboardText(title);
              setCopyResult({ title, success });
            }}
          >
            {t("sessionCopyTitle")}
          </button>
        )}
      </div>
      <p
        className={`${styles.title}${singleLine ? ` ${styles.singleLine}` : ""}`}
      >
        {title}
      </p>
      {showCopy && result && (
        <span className={styles.feedback} role="status">
          {t(result.success ? "sessionTitleCopied" : "sessionTitleCopyFailed")}
        </span>
      )}
    </section>
  );
}
