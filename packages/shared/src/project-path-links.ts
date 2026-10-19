/** A path occurrence the server proved can open in the current project viewer. */
export interface ProjectPathLinkTarget {
  /** Exact visible token to turn into a link. */
  text: string;
  /** Project-relative or authorized absolute path passed to the file viewer. */
  filePath: string;
}

export interface ProjectPathToken {
  end: number;
  kind: "absolute" | "relative";
  start: number;
  text: string;
}

/** A file position cited after a path: `:29`, `:29-56`, or `:29:7`. */
export interface CitedFilePosition {
  /** The citation exactly as written, leading colon included. */
  text: string;
  lineNumber: number;
  lineEnd?: number;
  columnNumber?: number;
}

const CITED_POSITION = ":([1-9]\\d*)(?:-([1-9]\\d*)|:([1-9]\\d*))?";
const LEADING_CITED_POSITION = new RegExp(`^${CITED_POSITION}(?!\\w)`);
const TRAILING_CITED_POSITION = new RegExp(`${CITED_POSITION}$`);

function toCitedFilePosition(match: RegExpExecArray): CitedFilePosition {
  const lineNumber = Number(match[1]);
  const lineEnd = match[2] ? Number(match[2]) : undefined;
  return {
    text: match[0],
    lineNumber,
    ...(lineEnd !== undefined && lineEnd > lineNumber ? { lineEnd } : {}),
    ...(match[3] ? { columnNumber: Number(match[3]) } : {}),
  };
}

/** The position cited at the very start of `text`, as after `src/a.ts`. */
export function readLeadingCitedPosition(
  text: string,
): CitedFilePosition | null {
  const match = LEADING_CITED_POSITION.exec(text);
  return match ? toCitedFilePosition(match) : null;
}

/** Split `path:42` into the path and the position it cites. */
export function splitTrailingCitedPosition(
  token: string,
): { path: string; position: CitedFilePosition } | null {
  const match = TRAILING_CITED_POSITION.exec(token);
  if (!match || match.index === 0) return null;
  return {
    path: token.slice(0, match.index),
    position: toCitedFilePosition(match),
  };
}

/**
 * Where the linked path ends for one confirmed token, and the position cited
 * right after it. An absolute token carries its own `:42` unless the whole
 * token is the file; a project-relative token stops at the colon, so its
 * citation is the text that follows.
 */
export function citedProjectPathTokenExtent(
  text: string,
  token: ProjectPathToken,
  filePath: string,
): { pathEnd: number; end: number; position: CitedFilePosition | null } {
  if (token.kind === "absolute") {
    const split = splitTrailingCitedPosition(token.text);
    if (!split || filePath.endsWith(split.position.text)) {
      return { pathEnd: token.end, end: token.end, position: null };
    }
    return {
      pathEnd: token.end - split.position.text.length,
      end: token.end,
      position: split.position,
    };
  }
  const position = readLeadingCitedPosition(text.slice(token.end));
  return {
    pathEnd: token.end,
    end: token.end + (position?.text.length ?? 0),
    position,
  };
}

/** Characters that can occur in a project-relative path token. */
const RELATIVE_PATH_TOKEN = /[^\s"'`<>&,:;()[\]{}=|]+/g;

/**
 * One absolute token runs from a whitespace boundary to the next whitespace.
 * `~/…` counts: it names one file under the server's home directory, which the
 * server expands; it is never a project-relative path.
 */
const ABSOLUTE_PATH_TOKEN = /(?:^|\s)((?:\/(?!\/)|~\/|[A-Za-z]:[\\/])\S+)/g;

/** Sentence punctuation is not part of a project-relative path. */
const TRAILING_NOISE = /[.!?]+$/;

/**
 * Split raw display text into the same candidate tokens used by server path
 * resolution. Consumers still need server-confirmed targets before linking.
 */
export function findProjectPathTokens(text: string): ProjectPathToken[] {
  const absoluteTokens: ProjectPathToken[] = [];

  ABSOLUTE_PATH_TOKEN.lastIndex = 0;
  let absoluteMatch: RegExpExecArray | null = ABSOLUTE_PATH_TOKEN.exec(text);
  while (absoluteMatch !== null) {
    const token = absoluteMatch[1];
    if (token) {
      const start =
        absoluteMatch.index + absoluteMatch[0].length - token.length;
      absoluteTokens.push({
        end: start + token.length,
        kind: "absolute",
        start,
        text: token,
      });
    }
    absoluteMatch = ABSOLUTE_PATH_TOKEN.exec(text);
  }

  const tokens = [...absoluteTokens];
  let absoluteIndex = 0;
  RELATIVE_PATH_TOKEN.lastIndex = 0;
  let relativeMatch: RegExpExecArray | null = RELATIVE_PATH_TOKEN.exec(text);
  while (relativeMatch !== null) {
    const rawToken = relativeMatch[0];
    const token = rawToken.replace(TRAILING_NOISE, "");
    const start = relativeMatch.index;
    const end = start + token.length;
    while (
      absoluteTokens[absoluteIndex] &&
      absoluteTokens[absoluteIndex]!.end <= start
    ) {
      absoluteIndex += 1;
    }
    const absolute = absoluteTokens[absoluteIndex];
    const overlapsAbsolute =
      !!absolute && start < absolute.end && end > absolute.start;
    if (
      token &&
      !token.startsWith("/") &&
      !token.startsWith("~/") &&
      !overlapsAbsolute
    ) {
      tokens.push({ end, kind: "relative", start, text: token });
    }
    relativeMatch = RELATIVE_PATH_TOKEN.exec(text);
  }

  return tokens.sort((left, right) => left.start - right.start);
}
