import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";
import styles from "./CockpitSessionMenu.module.css";

export interface CockpitSessionMenuProps {
  open: boolean;
  anchor: { x: number; y: number } | null;
  sessionTitle: string;
  pinned: boolean;
  busy: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onRename: (title: string) => Promise<boolean>;
  onArchive: () => Promise<boolean>;
}

type MenuView = "menu" | "rename" | "archive";

export function CockpitSessionMenu({
  open,
  anchor,
  sessionTitle,
  pinned,
  busy,
  onClose,
  onTogglePin,
  onRename,
  onArchive,
}: CockpitSessionMenuProps) {
  const { t } = useI18n();
  const [view, setView] = useState<MenuView>("menu");
  const [renameTitle, setRenameTitle] = useState(sessionTitle);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number }>({
    x: anchor ? Math.max(8, anchor.x) : 8,
    y: anchor ? Math.max(8, anchor.y) : 8,
  });

  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const archiveCancelButtonRef = useRef<HTMLButtonElement>(null);
  const prevActiveElementRef = useRef<HTMLElement | null>(null);

  // Reset internal states whenever the menu opens or session changes
  useEffect(() => {
    if (open) {
      setView("menu");
      setRenameTitle(sessionTitle);
      setRenameError(null);
      setArchiveError(null);
      setIsRenaming(false);
      setIsArchiving(false);
    }
  }, [open, sessionTitle]);

  // Capture active element before shifting focus, restore focus when closed
  useLayoutEffect(() => {
    if (open) {
      if (
        !prevActiveElementRef.current &&
        document.activeElement instanceof HTMLElement
      ) {
        prevActiveElementRef.current = document.activeElement;
      }

      if (view === "menu") {
        const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(
          'button[role="menuitem"]:not(:disabled)',
        );
        firstItem?.focus();
      } else if (view === "rename") {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          renameInputRef.current.select();
        }
      } else if (view === "archive") {
        archiveCancelButtonRef.current?.focus();
      }
    }
  }, [open, view]);

  // Restore focus to original trigger when menu closes
  useEffect(() => {
    if (!open && prevActiveElementRef.current) {
      if (prevActiveElementRef.current.isConnected) {
        prevActiveElementRef.current.focus();
      }
      prevActiveElementRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (prevActiveElementRef.current?.isConnected) {
        prevActiveElementRef.current.focus();
      }
    };
  }, []);

  // Measure popover rect and clamp coordinates inside viewport with 8px margin
  useLayoutEffect(() => {
    // The rename and archive panels differ in size; measure each one.
    void view;
    if (!open || !anchor || !menuRef.current) {
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    const viewportWidth =
      window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;

    const maxX = Math.max(margin, viewportWidth - rect.width - margin);
    const maxY = Math.max(margin, viewportHeight - rect.height - margin);

    const clampedX = Math.min(Math.max(margin, anchor.x), maxX);
    const clampedY = Math.min(Math.max(margin, anchor.y), maxY);

    setCoords({ x: clampedX, y: clampedY });
  }, [open, anchor, view]);

  // Outside pointer down closes the popover in capture phase
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDownOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDownOutside, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
    };
  }, [open, onClose]);

  const moveFocus = (delta: number) => {
    if (!menuRef.current) {
      return;
    }
    const items = Array.from(
      menuRef.current.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ),
    );
    if (items.length === 0) {
      return;
    }
    const activeIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (activeIndex === -1) {
      items[0]?.focus();
      return;
    }
    const nextIndex = (activeIndex + delta + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const focusFirst = () => {
    if (!menuRef.current) {
      return;
    }
    const items = menuRef.current.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    );
    items[0]?.focus();
  };

  const focusLast = () => {
    if (!menuRef.current) {
      return;
    }
    const items = menuRef.current.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    );
    items[items.length - 1]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation?.();
      onClose();
      return;
    }

    if (view === "menu") {
      if (event.key === "Tab") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusFirst();
      } else if (event.key === "End") {
        event.preventDefault();
        focusLast();
      }
    }
  };

  const handleTogglePin = () => {
    onTogglePin();
    onClose();
  };

  const handleRenameSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = renameTitle.trim();
    if (!trimmed || busy || isRenaming) {
      return;
    }
    setIsRenaming(true);
    setRenameError(null);
    try {
      const success = await onRename(trimmed);
      if (success) {
        onClose();
      } else {
        setRenameError(t("cockpitSessionMenuRenameError"));
      }
    } catch {
      setRenameError(t("cockpitSessionMenuRenameError"));
    } finally {
      setIsRenaming(false);
    }
  };

  const handleArchiveConfirm = async () => {
    if (busy || isArchiving) {
      return;
    }
    setIsArchiving(true);
    setArchiveError(null);
    try {
      const success = await onArchive();
      if (success) {
        onClose();
      } else {
        setArchiveError(t("cockpitSessionMenuArchiveError"));
      }
    } catch {
      setArchiveError(t("cockpitSessionMenuArchiveError"));
    } finally {
      setIsArchiving(false);
    }
  };

  if (!open || !anchor) {
    return null;
  }

  const isSaveDisabled = renameTitle.trim().length === 0 || busy || isRenaming;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the role is menu or dialog, chosen per panel below
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: both roles support aria-label
    <div
      ref={menuRef}
      role={view === "menu" ? "menu" : "dialog"}
      aria-label={t("cockpitSessionMenuAriaLabel", { name: sessionTitle })}
      className={styles.popover}
      style={{
        left: `${coords.x}px`,
        top: `${coords.y}px`,
      }}
      onKeyDown={handleKeyDown}
    >
      {view === "menu" && (
        <div className={styles.menuList}>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={handleTogglePin}
            disabled={busy}
          >
            {t(pinned ? "cockpitSessionMenuUnpin" : "cockpitSessionMenuPin")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => setView("rename")}
            disabled={busy}
          >
            {t("cockpitSessionMenuRename")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.destructive}`}
            onClick={() => setView("archive")}
            disabled={busy}
          >
            {t("cockpitSessionMenuArchive")}
          </button>
        </div>
      )}

      {view === "rename" && (
        <form className={styles.renameForm} onSubmit={handleRenameSubmit}>
          <input
            ref={renameInputRef}
            type="text"
            className={styles.input}
            value={renameTitle}
            onChange={(event) => {
              setRenameTitle(event.target.value);
              if (renameError) {
                setRenameError(null);
              }
            }}
            disabled={busy || isRenaming}
            aria-label={t("cockpitSessionMenuRenameInput")}
          />
          {renameError && (
            <div role="status" className={styles.error}>
              {renameError}
            </div>
          )}
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={onClose}
              disabled={busy || isRenaming}
            >
              {t("cockpitSessionMenuCancel")}
            </button>
            <button
              type="submit"
              className={styles.buttonPrimary}
              disabled={isSaveDisabled}
            >
              {t("cockpitSessionMenuSave")}
            </button>
          </div>
        </form>
      )}

      {view === "archive" && (
        <div className={styles.archivePanel}>
          <p className={styles.confirmText}>
            {t("cockpitSessionMenuArchiveConfirm", { name: sessionTitle })}
          </p>
          {archiveError && (
            <div role="status" className={styles.error}>
              {archiveError}
            </div>
          )}
          <div className={styles.buttonRow}>
            <button
              ref={archiveCancelButtonRef}
              type="button"
              className={styles.buttonSecondary}
              onClick={onClose}
              disabled={busy || isArchiving}
            >
              {t("cockpitSessionMenuCancel")}
            </button>
            <button
              type="button"
              className={`${styles.buttonPrimary} ${styles.destructiveButton}`}
              onClick={handleArchiveConfirm}
              disabled={busy || isArchiving}
            >
              {t("cockpitSessionMenuArchiveConfirmAction")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
