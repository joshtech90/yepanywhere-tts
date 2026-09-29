import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import styles from "./CockpitMobileDrawer.module.css";

/**
 * The open session on a phone has no bottom bar: its header opens this
 * drawer with the navigation and the latest sessions, like the ChatGPT app
 * (Joscha 26.09.2026). The shell provides the opener; outside a phone
 * session it is null and the header keeps its back link.
 */
const CockpitDrawerOpenerContext = createContext<(() => void) | null>(null);

export const CockpitDrawerOpenerProvider = CockpitDrawerOpenerContext.Provider;

export function useCockpitDrawerOpener(): (() => void) | null {
  return useContext(CockpitDrawerOpenerContext);
}

export interface CockpitMobileDrawerProps {
  children: ReactNode;
  label: string;
  onClose: () => void;
  open: boolean;
}

/**
 * A native modal dialog keeps focus inside and the page behind it inert;
 * Escape and a tap beside the panel close it, focus returns afterwards.
 */
export function CockpitMobileDrawer({
  children,
  label,
  onClose,
  open,
}: CockpitMobileDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    // The panel takes focus, not its first link: a focus ring on "Cockpit"
    // looked like a selection.
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      aria-label={label}
      className={styles.drawer}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        // Handled here so no page shortcut (Escape stops a session) sees it.
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        // The panel fills its own box; a click on the dialog itself is the
        // backdrop beside it.
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      <div className={styles.panel} ref={panelRef} tabIndex={-1}>
        {children}
      </div>
    </dialog>
  );
}
