import type { MouseEvent as ReactMouseEvent } from "react";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import styles from "./ViewerModeToggle.module.css";

export interface ViewerModeSource {
  path?: string;
  projectId?: string;
  artifactUrl?: string;
  relativeTo?: string;
}

/** A mode button for ordinary clicks and a real link for new-tab gestures. */
export function ViewerModeToggle({
  mode,
  source,
  artifact,
  line,
  column,
  active,
  disabled,
  label,
  onToggle,
  onContextMenu,
  href: explicitHref,
}: {
  mode: "edit" | "interactive";
  source: ViewerModeSource;
  artifact?: boolean;
  line?: number;
  column?: number;
  active: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
  /** Owner-supplied right-click menu; absent means the browser's own menu. */
  onContextMenu?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  /**
   * An explicit link target replacing the `/file-view` mode page, for a
   * mode whose document lives at its own URL such as a public share's play.
   */
  href?: string;
}) {
  const basePath = useRemoteBasePath();
  const query = new URLSearchParams({ mode });
  for (const [key, value] of Object.entries(source))
    if (value) query.set(key, value);
  if (artifact) query.set("artifact", "1");
  if (line) query.set("line", String(line));
  if (column) query.set("column", String(column));
  const href = explicitHref ?? `${basePath}/file-view?${query}`;
  return (
    <a
      className={styles.toggle}
      href={href}
      role="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      rel="noopener noreferrer"
      onKeyDown={(event) => {
        if (event.key === " ") {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        onToggle();
      }}
      onAuxClick={(event) => {
        if (disabled) event.preventDefault();
      }}
      onContextMenu={onContextMenu}
    >
      <span className={styles.label}>{label}</span>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {mode === "edit" ? (
          <>
            <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
            <path d="M13 20h7" />
          </>
        ) : (
          <path d="m8 5 11 7-11 7z" />
        )}
      </svg>
    </a>
  );
}
