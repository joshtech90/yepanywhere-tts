import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";
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
  focusReturnRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function CockpitShortcutDialog({
  focusReturnRef,
  onClose,
  open,
  triggerRef,
}: CockpitShortcutDialogProps) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      closeRef.current?.focus({ preventScroll: true });
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const focusTarget = focusReturnRef.current;
      const destination =
        focusTarget?.isConnected === true ? focusTarget : triggerRef.current;
      destination?.focus({ preventScroll: true });
    }
  }, [focusReturnRef, open, triggerRef]);

  if (!open) return null;

  const close = () => {
    onClose();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), ' +
          'select:not(:disabled), textarea:not(:disabled), ' +
          '[tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }

    const active = document.activeElement;
    if (!panel.contains(active)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
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
      <button
        aria-label={t("cockpitShortcutsClose")}
        className={styles.backdropDismiss}
        onClick={close}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-describedby="cockpit-shortcuts-description"
        aria-labelledby="cockpit-shortcuts-title"
        aria-modal="true"
        className={styles.panel}
        onKeyDown={handleKeyDown}
        ref={panelRef}
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
        <p className={styles.intro} id="cockpit-shortcuts-description">
          {t("cockpitShortcutsBody")}
        </p>
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
