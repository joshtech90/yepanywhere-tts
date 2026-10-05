import {
  type FileViewLineTarget,
  type FileViewSearchEntry,
  type FileViewSearchResult,
  formatFileViewLineSuffix,
  formatFileViewPart,
  parseFileViewArgument,
} from "@yep-anywhere/shared";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { fileViewSearchPath, readFileViewDraft } from "../lib/fileViewCommand";
import { recentProjectFileMentionSources } from "../lib/recentProjectPathLinks";
import { useFileViewPreview } from "./useFileViewPreview";

const EMPTY_ITEMS: RenderItem[] = [];

/** The directory part of a result path, with its trailing slash. */
function directoryOf(path: string): string | null {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash + 1) : null;
}

/**
 * Completion for the `/v` file-view command: while the draft is `/v parts…`,
 * list matching files (tracked first) in the sheet above the composer, with
 * a preview of the highlighted one. Tab puts its path in the draft, Enter
 * opens it, Ctrl+Enter opens it and keeps the sheet, Right narrows the query
 * to its directory. See `topics/view-command.md`.
 */
export function useFileViewCompletion(options: {
  enabled: boolean;
  projectId?: string | null;
  text: string;
  textarea: RefObject<HTMLTextAreaElement | null>;
  replace: (start: number, end: number, replacement: string) => string | null;
  /** Submit a draft as if the user had sent it. */
  submit: (text: string) => void;
  /** Open a result without submitting, keeping the draft. */
  open?: (path: string, line?: FileViewLineTarget) => void;
  /** Enter inserts a newline instead of sending (full-pane editing). */
  enterInsertsNewline?: boolean;
  items?: RenderItem[];
  disabled?: boolean;
}) {
  const runtime = useCurrentSourceRuntime();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [ignoredKey, setIgnoredKey] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    ignored: boolean;
    result?: FileViewSearchResult;
    error?: string;
  } | null>(null);

  const draft =
    options.enabled && !options.disabled && options.projectId
      ? readFileViewDraft(options.text)
      : null;
  const parsed = draft ? parseFileViewArgument(draft.argument) : null;
  const parts = parsed?.parts ?? [];
  const queryKey =
    draft && focused && parts.length > 0
      ? JSON.stringify([options.projectId, parts])
      : null;
  const visible = queryKey !== null && dismissed !== queryKey;
  const includeIgnored = queryKey !== null && ignoredKey === queryKey;
  useEffect(() => {
    setDismissed((previous) => (previous === queryKey ? previous : null));
    setSelection(null);
  }, [queryKey]);

  const items = options.items ?? EMPTY_ITEMS;
  const mentions = useMemo(
    () => (visible ? recentProjectFileMentionSources(items) : []),
    [items, visible],
  );
  const recent = useMemo(() => mentions.map(({ path }) => path), [mentions]);
  const mentionIds = useMemo(
    () => new Map(mentions.map(({ path, itemId }) => [path, itemId])),
    [mentions],
  );

  useEffect(() => {
    if (!visible || !queryKey || !options.projectId) return;
    const partsForQuery = JSON.parse(queryKey)[1] as string[];
    let stopped = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const path = fileViewSearchPath(options.projectId, partsForQuery, {
      recent,
      includeIgnored,
    });
    const read = async () => {
      try {
        const result = await runtime.transport.fetch<FileViewSearchResult>(
          path,
          { signal: abort.signal },
        );
        if (stopped) return;
        setSnapshot({ key: queryKey, ignored: includeIgnored, result });
        if (result.pending) timer = setTimeout(read, 250);
      } catch (error) {
        if (!stopped)
          setSnapshot({
            key: queryKey,
            ignored: includeIgnored,
            error: error instanceof Error ? error.message : String(error),
          });
      }
    };
    // Coalesce ordinary typing; requests never gate the keystroke itself.
    timer = setTimeout(read, 75);
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [visible, queryKey, options.projectId, recent, includeIgnored, runtime]);

  const current = visible && snapshot?.key === queryKey ? snapshot : null;
  const entries = current?.result?.entries ?? [];
  const selected =
    entries.find((entry) => entry.path === selection) ?? entries[0];
  const settledEmpty =
    !!current?.result && !current.result.pending && entries.length === 0;
  const preview = useFileViewPreview(
    visible ? options.projectId : null,
    selected?.path,
    parsed?.line,
  );

  /** The draft that names exactly `entry`, keeping any line target. */
  function draftFor(entry: FileViewSearchEntry): string {
    return `/${draft?.command ?? "v"} ${formatFileViewPart(entry.path)}${formatFileViewLineSuffix(parsed?.line)}`;
  }

  function setDraft(next: string) {
    const textarea = options.textarea.current;
    if (!textarea) return;
    options.replace(0, options.text.length, next);
    textarea.setSelectionRange(next.length, next.length);
  }

  function accept(entry: FileViewSearchEntry) {
    if (!draft || !visible) return;
    setDraft(draftFor(entry));
    // The accepted path is its own exact query; keep the sheet closed on it.
    setDismissed(JSON.stringify([options.projectId, [entry.path]]));
  }

  /** Replace the query with the entry's directory, to browse inside it. */
  function narrow(entry: FileViewSearchEntry): boolean {
    const directory = directoryOf(entry.path);
    if (!draft || !directory) return false;
    setDraft(`/${draft.command} ${formatFileViewPart(directory)}`);
    return true;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (
      event.nativeEvent.isComposing ||
      !visible ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return false;
    if (event.ctrlKey) {
      if (event.key !== "Enter" || !selected || !options.open) return false;
      event.preventDefault();
      options.open(selected.path, parsed?.line);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(queryKey);
      return true;
    }
    if (selected && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const index = entries.indexOf(selected);
      setSelection(
        entries[
          (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) %
            entries.length
        ]?.path ?? null,
      );
      return true;
    }
    if (event.key === "ArrowRight" && selected) {
      // Only at the end of the draft; elsewhere Right moves the caret.
      const textarea = options.textarea.current;
      if (
        textarea?.selectionStart !== options.text.length ||
        textarea.selectionEnd !== options.text.length
      )
        return false;
      if (!narrow(selected)) return false;
      event.preventDefault();
      return true;
    }
    if (event.key === "Tab" && selected) {
      event.preventDefault();
      accept(selected);
      return true;
    }
    if (event.key === "Enter" && selected && !options.enterInsertsNewline) {
      event.preventDefault();
      options.submit(draftFor(selected));
      return true;
    }
    return false;
  }

  return {
    visible,
    entries,
    selected: selected?.path,
    select: (entry: FileViewSearchEntry) => setSelection(entry.path),
    accept,
    onKeyDown,
    pending:
      visible &&
      (!current ||
        current.ignored !== includeIgnored ||
        !!current.result?.pending),
    truncated: current?.result?.truncated ?? false,
    error: current?.error,
    /** The transcript item that last mentioned `path`, if loaded. */
    mentionOf: (path: string) => mentionIds.get(path),
    /** Offer the explicit ignored-file search: nothing else matched. */
    canSearchIgnored: settledEmpty && !current?.ignored && !includeIgnored,
    searchIgnored: () => setIgnoredKey(queryKey),
    ignoredSearched: !!current?.ignored,
    preview,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
