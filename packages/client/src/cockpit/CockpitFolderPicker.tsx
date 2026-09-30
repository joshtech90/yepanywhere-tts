import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../api/client";
import { useI18n } from "../i18n";
import styles from "./CockpitFolderPicker.module.css";

interface FolderListing {
  path: string;
  parent: string | null;
  home: string;
  entries: Array<{ name: string; path: string }>;
  truncated: boolean;
}

export interface CockpitFolderPickerProps {
  /** Where to start; an unknown folder falls back to the home folder. */
  initialPath?: string;
  onClose: () => void;
  onPick: (path: string) => void;
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l1.7 2H20.5v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V7.5Z" />
    </svg>
  );
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** Home prefixes shortened, as in the folder list of the page. */
function shortPath(path: string, home: string): string {
  if (home && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/**
 * Walks the folders of the server host (Joscha 30.09.2026: "a folder symbol
 * to pick the folder like in the Finder"). A browser's own dialog cannot name
 * a folder on the host, and on a phone it would show the phone's files, so
 * this lists the host's folders through the server instead.
 */
export function CockpitFolderPicker({
  initialPath,
  onClose,
  onPick,
}: CockpitFolderPickerProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const requestRef = useRef(0);

  const load = useCallback(
    async (path: string | undefined, fallbackHome: boolean) => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      // Reset when the walk starts, so letters typed while it loads stay.
      setFilter("");
      try {
        const next = await api.browseDirectories(path);
        if (request !== requestRef.current) return;
        setListing(next);
        listRef.current?.scrollTo?.({ top: 0 });
      } catch (err) {
        if (request !== requestRef.current) return;
        if (fallbackHome && errorStatus(err) === 404) {
          // A remembered folder that is gone: start at home instead.
          void load(undefined, false);
          return;
        }
        setError(
          errorStatus(err) === 403
            ? t("cockpitFolderPickerDenied")
            : t("cockpitFolderPickerError"),
        );
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    },
    [t],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once on open
  useEffect(() => {
    void load(initialPath || undefined, true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else dialog.removeAttribute("open");
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const needle = deferredFilter.trim().toLocaleLowerCase();
  const entries = listing
    ? needle
      ? listing.entries.filter((entry) =>
          entry.name.toLocaleLowerCase().includes(needle),
        )
      : listing.entries
    : [];

  return (
    <dialog
      aria-labelledby="cockpit-folder-picker-title"
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        // Kept here so no page shortcut (Escape stops a session) sees it.
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 id="cockpit-folder-picker-title">
            {t("cockpitFolderPickerTitle")}
          </h2>
          <div className={styles.toolbar}>
            <button
              aria-label={t("cockpitFolderPickerUp")}
              className={styles.toolButton}
              disabled={!listing?.parent || loading}
              onClick={() =>
                listing?.parent && void load(listing.parent, false)
              }
              title={t("cockpitFolderPickerUp")}
              type="button"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
              </svg>
            </button>
            <button
              aria-label={t("cockpitFolderPickerHome")}
              className={styles.toolButton}
              disabled={loading}
              onClick={() => void load(undefined, false)}
              title={t("cockpitFolderPickerHome")}
              type="button"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 11 12 4.5l8 6.5M6.5 9.5V19.5h11V9.5" />
              </svg>
            </button>
            <p className={styles.path} title={listing?.path}>
              {listing ? shortPath(listing.path, listing.home) : "…"}
            </p>
          </div>
          <input
            aria-label={t("cockpitFolderPickerFilter")}
            className={styles.filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder={t("cockpitFolderPickerFilter")}
            type="search"
            value={filter}
          />
        </header>

        <ul
          aria-busy={loading}
          aria-label={t("cockpitFolderPickerListLabel")}
          className={styles.list}
          ref={listRef}
        >
          {error && (
            <li className={styles.message} role="alert">
              {error}
            </li>
          )}
          {!error && listing && entries.length === 0 && !loading && (
            <li className={styles.message}>{t("cockpitFolderPickerEmpty")}</li>
          )}
          {entries.map((entry) => (
            <li key={entry.path}>
              <button
                className={styles.entry}
                disabled={loading}
                onClick={() => void load(entry.path, false)}
                type="button"
              >
                <FolderIcon />
                <span>{entry.name}</span>
              </button>
            </li>
          ))}
          {listing?.truncated && (
            <li className={styles.message}>
              {t("cockpitFolderPickerTruncated")}
            </li>
          )}
        </ul>

        <footer className={styles.actions}>
          <button className={styles.secondary} onClick={onClose} type="button">
            {t("cockpitNewSessionCancel")}
          </button>
          <button
            className={styles.primary}
            disabled={!listing || loading}
            onClick={() => listing && onPick(listing.path)}
            type="button"
          >
            {t("cockpitFolderPickerChoose")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
