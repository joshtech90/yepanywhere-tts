import {
  Fragment,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranscriptRenderWindow } from "../hooks/useTranscriptRenderWindow";
import type { CockpitTranscriptEntry } from "./core/sessionDetail";
import styles from "./CockpitSessionDetail.module.css";

const TRANSCRIPT_RENDER_MARKER_STYLE = {
  display: "block",
  height: 0,
  overflow: "hidden",
  pointerEvents: "none",
} as const;

function getEntryTargetIds(entry: CockpitTranscriptEntry) {
  return [entry.key];
}

function getEntryRenderWeight() {
  return 1;
}

function hasOpenDisclosure(entry: HTMLElement): boolean {
  return (
    (entry instanceof HTMLDetailsElement && entry.open) ||
    entry.querySelector("details[open]") !== null
  );
}

export interface CockpitTranscriptWindowProps {
  /** Live tail below the last row, such as the working indicator. */
  afterRows?: ReactNode;
  beforeRows: ReactNode;
  entries: readonly CockpitTranscriptEntry[];
  following: boolean;
  pinnedEntryKey: string | null;
  renderEntry: (entry: CockpitTranscriptEntry) => ReactNode;
}

/**
 * Reuses the measured-height transcript window from the established session
 * view. The canonical Cockpit entry array remains complete; only distant DOM
 * rows are replaced by measured spacers while the reader moves through it.
 */
export function CockpitTranscriptWindow({
  afterRows,
  beforeRows,
  entries,
  following,
  pinnedEntryKey,
  renderEntry,
}: CockpitTranscriptWindowProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [retainedEntryKeys, setRetainedEntryKeys] = useState<string[]>([]);
  const retainOpenEntry = useCallback((event: Event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    const entry = details.closest<HTMLElement>("[data-cockpit-entry-key]");
    const entryKey = entry?.dataset.cockpitEntryKey;
    if (!entryKey) return;
    const shouldRetain = hasOpenDisclosure(entry);
    setRetainedEntryKeys((previous) => {
      const retained = previous.includes(entryKey);
      if (shouldRetain === retained) return previous;
      return shouldRetain
        ? [...previous, entryKey]
        : previous.filter((key) => key !== entryKey);
    });
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.addEventListener("toggle", retainOpenEntry, true);
    return () => list.removeEventListener("toggle", retainOpenEntry, true);
  }, [retainOpenEntry]);

  const renderWindow = useTranscriptRenderWindow({
    containerRef: listRef,
    followTail: following,
    getRowTargetIds: getEntryTargetIds,
    getRowWeight: getEntryRenderWeight,
    pinnedRenderId: pinnedEntryKey,
    retainedRenderIds: retainedEntryKeys,
    rows: entries,
  });

  return (
    <div className={styles.transcriptInner} ref={listRef}>
      {beforeRows}
      {renderWindow.active && (
        <span
          ref={renderWindow.registerListStart}
          aria-hidden="true"
          data-cockpit-render-boundary="start"
          style={TRANSCRIPT_RENDER_MARKER_STYLE}
        />
      )}
      {renderWindow.beforeHeightPx > 0 && (
        <div
          aria-hidden="true"
          data-cockpit-render-spacer="before"
          style={{ height: renderWindow.beforeHeightPx }}
        />
      )}
      {renderWindow.rows.map((entry) => {
        const renderedEntry = renderEntry(entry);
        if (!renderWindow.active) {
          return <Fragment key={entry.key}>{renderedEntry}</Fragment>;
        }
        const spacerBefore = renderWindow.getRowSpacerBefore(entry.key);
        return (
          <Fragment key={entry.key}>
            {spacerBefore > 0 && (
              <div
                aria-hidden="true"
                data-cockpit-render-spacer="between"
                style={{ height: spacerBefore }}
              />
            )}
            <span
              ref={(element) => {
                renderWindow.registerRowStart(entry.key, element);
              }}
              aria-hidden="true"
              data-cockpit-render-boundary="row-start"
              style={TRANSCRIPT_RENDER_MARKER_STYLE}
            />
            <div
              className={styles.transcriptRow}
              data-cockpit-entry-key={entry.key}
              data-render-id={entry.key}
            >
              {renderedEntry}
            </div>
            <span
              ref={(element) => {
                renderWindow.registerRowEnd(entry.key, element);
              }}
              aria-hidden="true"
              data-cockpit-render-boundary="row-end"
              style={TRANSCRIPT_RENDER_MARKER_STYLE}
            />
          </Fragment>
        );
      })}
      {renderWindow.afterHeightPx > 0 && (
        <div
          aria-hidden="true"
          data-cockpit-render-spacer="after"
          style={{ height: renderWindow.afterHeightPx }}
        />
      )}
      {afterRows}
    </div>
  );
}
