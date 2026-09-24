import { useEffect, useRef, type RefObject } from "react";
import { useI18n } from "../i18n";
import styles from "./CockpitShortcutHelp.module.css";

export interface CockpitShortcutButtonProps {
  onOpen: () => void;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h1M7.5 14h9" />
    </svg>
  );
}

export function CockpitShortcutButton({
  onOpen,
  open,
  triggerRef,
}: CockpitShortcutButtonProps) {
  const { t } = useI18n();
  return (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-keyshortcuts="?"
      aria-label={t("cockpitShortcutsOpen")}
      className={styles.trigger}
      onClick={onOpen}
      ref={triggerRef}
      type="button"
    >
      <span className={styles.icon}>
        <KeyboardIcon />
      </span>
      <span>{t("cockpitShortcutsNav")}</span>
    </button>
  );
}

export interface CockpitShortcutDialogProps {
  onClose: () => void;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function CockpitShortcutDialog({
  onClose,
  open,
  triggerRef,
}: CockpitShortcutDialogProps) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  const close = () => {
    onClose();
    triggerRef.current?.focus({ preventScroll: true });
  };
  const shortcuts = [
    ["/", t("cockpitShortcutSearch")],
    ["N", t("cockpitShortcutNewSession")],
    ["R", t("cockpitShortcutComposer")],
    ["Ctrl / ⌘ + Enter", t("cockpitShortcutQueue")],
    ["Esc", t("cockpitShortcutStop")],
    ["G S", t("cockpitShortcutSessions")],
    ["G P", t("cockpitShortcutProjects")],
    ["?", t("cockpitShortcutHelpAction")],
  ] as const;

  return (
    <div className={styles.backdrop}>
      <section
        aria-labelledby="cockpit-shortcuts-title"
        className={styles.panel}
        role="dialog"
      >
        <header>
          <div>
            <p>{t("cockpitShortcutsEyebrow")}</p>
            <h2 id="cockpit-shortcuts-title">
              {t("cockpitShortcutsTitle")}
            </h2>
          </div>
          <button
            aria-label={t("cockpitShortcutsClose")}
            className={styles.close}
            onClick={close}
            ref={closeRef}
            type="button"
          >
            ×
          </button>
        </header>
        <p className={styles.intro}>{t("cockpitShortcutsBody")}</p>
        <dl>
          {shortcuts.map(([keys, label]) => (
            <div key={keys}>
              <dt>
                {keys.split(" ").map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.note}>{t("cockpitShortcutsEditingNote")}</p>
      </section>
    </div>
  );
}
