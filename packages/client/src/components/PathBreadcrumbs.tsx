import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import styles from "./PathBreadcrumbs.module.css";

interface PathBreadcrumbsProps {
  /** A "/"-separated display path; its last segment is the current name. */
  path: string;
  /** Index (in `path.split("/")`) of the folder whose list or menu is open. */
  activeSegment?: number | null;
  /**
   * Makes each folder segment a button. Absent, the path renders as the plain
   * text it always was, which is how a public share shows it.
   */
  onFolderActivate?: (segment: number, anchor: HTMLElement) => void;
  onFolderContextMenu?: (segment: number, event: ReactMouseEvent) => void;
  /** Makes the final name a button too, without link styling. */
  onNameActivate?: (anchor: HTMLElement) => void;
  /**
   * A folder segment's own URL. With one the segment is a real link, so a
   * middle, modified or context-menu click opens it in a new tab while a plain
   * click still activates in place.
   */
  folderHref?: (segment: number) => string | undefined;
  /** The final name's URL, with the same split as `folderHref`. */
  nameHref?: string;
}

/** A plain primary click; anything else is left to the browser's link handling. */
function isPlainClick(event: ReactMouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * One activatable segment: a link when it has a URL, else a button-role span.
 * Either is an inline element, so a long name still wraps mid-segment. Enter
 * clicks a link natively; Space is added so both forms answer the same keys.
 */
function SegmentTarget({
  activate,
  children,
  className,
  href,
  onContextMenu,
  ...aria
}: {
  activate: (anchor: HTMLElement) => void;
  children: ReactNode;
  className?: string;
  href?: string;
  onContextMenu?: (event: ReactMouseEvent) => void;
  "aria-current"?: "page";
  "aria-expanded"?: boolean;
  "data-active"?: true;
  "data-segment": number;
}) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== " " && (href || event.key !== "Enter")) return;
    event.preventDefault();
    activate(event.currentTarget);
  };
  if (href) {
    return (
      <a
        {...aria}
        href={href}
        aria-haspopup="dialog"
        className={className}
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          activate(event.currentTarget);
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={onContextMenu}
      >
        {children}
      </a>
    );
  }
  return (
    <span
      {...aria}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      className={className}
      onClick={(event) => activate(event.currentTarget)}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
    >
      {children}
    </span>
  );
}

/**
 * A file path whose folders can be opened, web-breadcrumb style: folder
 * segments are link-colored, separators are inert, and the current name is
 * plain text. Navigation belongs to the caller; segment indexes refer to
 * `path.split("/")`, and empty segments (a leading "/") are never targets.
 * Each target carries its index as `data-segment`.
 */
export function PathBreadcrumbs({
  path,
  activeSegment = null,
  onFolderActivate,
  onFolderContextMenu,
  onNameActivate,
  folderHref,
  nameHref,
}: PathBreadcrumbsProps) {
  if (!onFolderActivate) return <>{path}</>;
  const segments = path.split("/");
  const last = segments.length - 1;
  const name = segments[last] ?? "";
  return (
    <>
      {segments.slice(0, last).map((segment, index) => (
        // A path's segments are positional.
        <Fragment key={`${index}:${segment}`}>
          {segment === "" ? null : (
            <SegmentTarget
              href={folderHref?.(index)}
              aria-expanded={activeSegment === index}
              data-active={activeSegment === index || undefined}
              data-segment={index}
              className={styles.segment}
              activate={(anchor) => onFolderActivate(index, anchor)}
              onContextMenu={
                onFolderContextMenu
                  ? (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onFolderContextMenu(index, event);
                    }
                  : undefined
              }
            >
              {segment}
            </SegmentTarget>
          )}
          <span className={styles.separator}>/</span>
          <wbr />
        </Fragment>
      ))}
      {onNameActivate ? (
        <SegmentTarget
          href={nameHref}
          aria-current="page"
          data-segment={last}
          className={styles.name}
          activate={onNameActivate}
        >
          {name}
        </SegmentTarget>
      ) : (
        <span className={styles.name} aria-current="page">
          {name}
        </span>
      )}
    </>
  );
}
