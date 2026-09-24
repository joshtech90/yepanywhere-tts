import { useState } from "react";
import { useI18n } from "../i18n";
import type { CockpitPromptHistoryEntry } from "./core/composer";
import styles from "./CockpitPromptHistory.module.css";

export interface CockpitPromptHistoryProps {
  entries: readonly CockpitPromptHistoryEntry[];
  frequent: readonly CockpitPromptHistoryEntry[];
  onRemove: (text: string) => void;
  onUse: (text: string) => void;
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8V4m0 0h4M4 4l3.2 3.2A7 7 0 1 1 5 14" />
      <path d="M12 8v4l2.8 1.8" />
    </svg>
  );
}

export function CockpitPromptHistory({
  entries,
  frequent,
  onRemove,
  onUse,
}: CockpitPromptHistoryProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  const selectPrompt = (text: string) => {
    onUse(text);
    setOpen(false);
  };

  return (
    <div className={styles.root}>
      <button
        aria-expanded={open}
        aria-label={t("cockpitPromptHistoryOpen")}
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <HistoryIcon />
      </button>
      {open && (
        <div className={styles.panel}>
          {frequent.length > 0 && (
            <section aria-labelledby="cockpit-frequent-prompts">
              <h2 id="cockpit-frequent-prompts">
                {t("cockpitPromptFrequent")}
              </h2>
              <div className={styles.frequent}>
                {frequent.map((entry) => (
                  <button
                    key={entry.text}
                    onClick={() => selectPrompt(entry.text)}
                    title={entry.text}
                    type="button"
                  >
                    <span>{entry.text}</span>
                    <small>
                      {t("cockpitPromptUseCount", { count: entry.useCount })}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="cockpit-recent-prompts">
            <h2 id="cockpit-recent-prompts">{t("cockpitPromptRecent")}</h2>
            <ul className={styles.recent}>
              {entries.map((entry) => (
                <li key={entry.text}>
                  <button
                    onClick={() => selectPrompt(entry.text)}
                    title={entry.text}
                    type="button"
                  >
                    {entry.text}
                  </button>
                  <button
                    aria-label={t("cockpitPromptRemove", {
                      prompt: entry.text,
                    })}
                    onClick={() => onRemove(entry.text)}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
