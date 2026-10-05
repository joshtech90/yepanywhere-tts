import type {
  FileContentResponse,
  FileViewLineTarget,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";

const PREVIEW_LINES = 12;
const CACHE_LIMIT = 24;

export interface FileViewPreview {
  /** First line's 1-indexed number. */
  startLine: number;
  lines: string[];
  /** The file has lines past the window. */
  more: boolean;
  /** Line numbers the draft cited, to emphasize. */
  cited?: FileViewLineTarget;
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; preview: FileViewPreview }
  | { status: "unavailable" };

/**
 * A few lines of the highlighted `/v` result, or of the cited range when the
 * draft names one. Reads through the file endpoint's bounded range view,
 * waits for the highlight to rest, cancels on change, and keeps a small
 * cache, so arrowing through results never gates typing or floods requests.
 */
export function useFileViewPreview(
  projectId: string | null | undefined,
  path: string | undefined,
  cited: FileViewLineTarget | undefined,
): PreviewState | null {
  const runtime = useCurrentSourceRuntime();
  const cache = useRef(new Map<string, PreviewState>());
  const [state, setState] = useState<{
    key: string;
    value: PreviewState;
  } | null>(null);
  const key =
    projectId && path
      ? JSON.stringify([projectId, path, cited?.lineNumber, cited?.lineEnd])
      : null;
  // The draft re-parses every render; the key already carries the values.
  const citedRef = useRef(cited);
  citedRef.current = cited;

  useEffect(() => {
    if (!key || !projectId || !path) return;
    const cited = citedRef.current;
    const cached = cache.current.get(key);
    if (cached) {
      setState({ key, value: cached });
      return;
    }
    const start = cited ? Math.max(1, cited.lineNumber - 2) : 1;
    // One line past the window: if it arrives, the file continues. A total
    // line count would miscount the empty "line" after a final newline.
    const params = new URLSearchParams({
      path,
      line: String(start),
      lineEnd: String(start + PREVIEW_LINES),
      view: "range",
    });
    const abort = new AbortController();
    const remember = (value: PreviewState) => {
      cache.current.set(key, value);
      while (cache.current.size > CACHE_LIMIT) {
        const oldest = cache.current.keys().next().value;
        if (oldest === undefined) break;
        cache.current.delete(oldest);
      }
      setState({ key, value });
    };
    const timer = setTimeout(async () => {
      try {
        const file = await runtime.transport.fetch<FileContentResponse>(
          `/projects/${projectId}/files?${params}`,
          { signal: abort.signal },
        );
        if (file.content === undefined) {
          remember({ status: "unavailable" });
          return;
        }
        const lines = file.content.split("\n");
        if (lines.at(-1) === "") lines.pop();
        remember({
          status: "ready",
          preview: {
            startLine: file.contentStartLine ?? start,
            lines: lines.slice(0, PREVIEW_LINES),
            more: lines.length > PREVIEW_LINES,
            cited,
          },
        });
      } catch {
        if (!abort.signal.aborted) remember({ status: "unavailable" });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key, projectId, path, runtime]);

  if (!key) return null;
  return state?.key === key ? state.value : { status: "loading" };
}
