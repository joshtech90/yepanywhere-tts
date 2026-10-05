/**
 * `/v` / `/view`: open a project file in the file viewer from a few
 * remembered parts of its path. See `topics/view-command.md`.
 */

/** Where a matched file came from, in the order results are ranked. */
export type FileViewSearchTier =
  /** Named exactly: an existing project-relative, absolute, or `~/` file. */
  | "path"
  | "tracked"
  | "untracked"
  | "ignored"
  /** Found under an existing absolute directory outside the project. */
  | "outside";

export interface FileViewSearchEntry {
  /** Project-relative for project files; absolute outside the project. */
  path: string;
  tier: FileViewSearchTier;
  /**
   * `[start, end)` offsets into `path` where the root anchor and each part
   * matched, in order. Absent for a path named exactly, and when case
   * folding changed the path's length.
   */
  spans?: [number, number][];
}

export interface FileViewSearchResult {
  entries: FileViewSearchEntry[];
  /** More candidates may arrive; the untracked inventory is still filling. */
  pending: boolean;
  /** A budget cut the match set; narrowing the parts can find the rest. */
  truncated: boolean;
}

/** Most parts one request may carry; each is at most `MAX_PART_LENGTH`. */
export const FILE_VIEW_MAX_PARTS = 16;
export const FILE_VIEW_MAX_PART_LENGTH = 4096;

export interface FileViewLineTarget {
  lineNumber: number;
  lineEnd?: number;
}

export interface ParsedFileViewArgument {
  parts: string[];
  line?: FileViewLineTarget;
}

/**
 * Split a `/v` argument into its path parts. Whitespace separates parts; a
 * double-quoted part may contain whitespace and `\"`/`\\` escapes, matching
 * the quoting composer path completion inserts. A line target written the way
 * agents cite code — `path:42`, `path:42:7`, `path:42-60`, `path#L42`,
 * `path#L42-L60` — is taken from the last part; it is never a search needle.
 */
export function parseFileViewArgument(
  argument: string,
): ParsedFileViewArgument {
  const parts: string[] = [];
  let index = 0;
  while (index < argument.length) {
    while (index < argument.length && /\s/.test(argument[index] ?? "")) index++;
    if (index >= argument.length) break;
    // Quoted and bare segments join until whitespace, as in a shell, so a
    // quoted path keeps its `:line` suffix.
    let part = "";
    while (index < argument.length && !/\s/.test(argument[index] ?? "")) {
      if (argument[index] !== '"') {
        part += argument[index];
        index++;
        continue;
      }
      index++;
      while (index < argument.length && argument[index] !== '"') {
        const char = argument[index] ?? "";
        const next = argument[index + 1];
        if (char === "\\" && (next === '"' || next === "\\")) {
          part += next;
          index += 2;
        } else {
          part += char;
          index++;
        }
      }
      index++;
    }
    if (part) parts.push(part);
  }

  const last = parts.at(-1);
  if (last === undefined) return { parts };
  const match =
    /^(.+?)(?::(\d+)(?:(?::\d+)|(?:-(\d+)))?|#L(\d+)(?:-L?(\d+))?)$/.exec(last);
  if (!match?.[1]) return { parts };
  const lineNumber = Number(match[2] ?? match[4]);
  const lineEndText = match[3] ?? match[5];
  const lineEnd = lineEndText === undefined ? undefined : Number(lineEndText);
  if (!(lineNumber > 0)) return { parts };
  parts[parts.length - 1] = match[1];
  return {
    parts,
    line:
      lineEnd !== undefined && lineEnd > lineNumber
        ? { lineNumber, lineEnd }
        : { lineNumber },
  };
}

/** Spell one path as a single `/v` part, quoting it when it needs quotes. */
export function formatFileViewPart(path: string): string {
  return /[\s"\\]/.test(path) ? JSON.stringify(path) : path;
}

/** The `:line` / `:start-end` suffix that reproduces a parsed line target. */
export function formatFileViewLineSuffix(line?: FileViewLineTarget): string {
  if (!line) return "";
  return line.lineEnd !== undefined
    ? `:${line.lineNumber}-${line.lineEnd}`
    : `:${line.lineNumber}`;
}
