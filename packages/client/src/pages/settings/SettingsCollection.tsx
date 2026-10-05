import { useEffect, useId, useRef, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import styles from "./SettingsCollection.module.css";

/** A settings table with one selected item's options in a neighboring pane. */
export function SettingsCollection({
  children,
  selectedKey,
  title,
  detail,
  onClose,
  actions,
}: {
  children: ReactNode;
  selectedKey: string | number | null;
  title: string;
  detail: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (selectedKey === null) return;
    trigger.current = document.activeElement as HTMLElement | null;
    close.current?.focus();
  }, [selectedKey]);
  function dismiss() {
    onClose();
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <div className={styles.root}>
      <div
        className={`${styles.collection} ${selectedKey !== null ? styles.open : ""}`}
      >
        <div className={styles.list}>{children}</div>
        {selectedKey !== null && (
          <section className={styles.detail} aria-labelledby={titleId}>
            <div className={styles.heading}>
              <h4 id={titleId}>{title}</h4>
              {actions}
              <button
                ref={close}
                type="button"
                onClick={dismiss}
                aria-label={t("settingsCollectionMinimize")}
                title={t("settingsCollectionMinimize")}
              >
                <span aria-hidden="true">_</span>
              </button>
            </div>
            {detail}
          </section>
        )}
      </div>
    </div>
  );
}
