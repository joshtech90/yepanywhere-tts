import { useEffect, useMemo, useRef, useState } from "react";
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
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (!open || entries.length === 0) return;
    inputRef.current?.focus({ preventScroll: true });
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      restoreFocusRef.current = false;
      setOpen(false);
    };
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocusRef.current = true;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape, true);
    };
  }, [entries.length, open]);

  useEffect(() => {
    if (entries.length === 0 && open) setOpen(false);
  }, [entries.length, open]);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleEntries = useMemo(
    () =>
      normalizedQuery
        ? entries.filter((entry) =>
            entry.text.toLowerCase().includes(normalizedQuery),
          )
        : entries,
    [entries, normalizedQuery],
  );
  const visibleFrequent = useMemo(
    () =>
      normalizedQuery
        ? frequent.filter((entry) =>
            entry.text.toLowerCase().includes(normalizedQuery),
          )
        : frequent,
    [frequent, normalizedQuery],
  );

  if (entries.length === 0) return null;

  const selectPrompt = (text: string) => {
    onUse(text);
    restoreFocusRef.current = true;
    setOpen(false);
  };
  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-controls="cockpit-prompt-history-panel"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("cockpitPromptHistoryOpen")}
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <HistoryIcon />
      </button>
      {open && (
        <div
          aria-labelledby="cockpit-recent-prompts"
          className={styles.panel}
          id="cockpit-prompt-history-panel"
          ref={panelRef}
          role="dialog"
        >
          <label className={styles.search}>
            <span>{t("cockpitPromptHistoryFilter")}</span>
            <input
              aria-label={t("cockpitPromptHistoryFilter")}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("cockpitPromptHistoryFilter")}
              ref={inputRef}
              type="search"
              value={query}
            />
          </label>

          {visibleFrequent.length > 0 && (
            <section aria-labelledby="cockpit-frequent-prompts">
              <h2 id="cockpit-frequent-prompts">
                {t("cockpitPromptFrequent")}
              </h2>
              <div className={styles.frequent}>
                {visibleFrequent.map((entry) => (
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
            {visibleEntries.length > 0 ? (
              <ul className={styles.recent}>
                {visibleEntries.map((entry) => (
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
            ) : (
              <p className={styles.empty} role="status">
                {t("cockpitPromptHistoryNoMatches")}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
