/** Deterministic references; no tracker calls, registry prerequisite or Git access. */

import { issueUrl } from "@yep-anywhere/shared";

/**
 * Version of the extraction rules in this file. Every evidence row records the
 * version that produced it, so rows written before a rules change can be told
 * apart from rows a later reader would produce from the same text. Bump it when
 * a change here would give a different answer for text already captured.
 */
export const EXTRACTOR_VERSION = 3;

export interface IssueReference {
  key: string;
  identity: string | null;
  url: string | null;
  provider: "jira" | "github";
  kind: "issue" | "pr" | "unknown";
  title: string | null;
  contextual?: boolean;
  start: number;
  end: number;
}

export { issueUrl };

/**
 * Whether a link label only names its item — `#42`, `repo#42`, `PR #42`, the
 * key itself — and so says nothing a title should. Titles saved before this
 * rule are read through it too, because the first observed title is kept.
 */
export function isReferenceLabel(label: string, key: string): boolean {
  const name = label
    .replace(/[`*_]/g, "")
    .replace(/^(?:pr|pull request|issue)\s*/i, "")
    .trim()
    .toLowerCase();
  const own = key.toLowerCase();
  return (
    name === own ||
    own.endsWith(`/${name}`) ||
    (name.startsWith("#") && own.endsWith(name))
  );
}

/**
 * Fenced code blocks: from a line opening with ``` or ~~~ to the line closing
 * it with the same character, or to the end of the text when none does.
 */
export function codeFences(text: string): Array<[number, number]> {
  const fences: Array<[number, number]> = [];
  let open: { marker: string; start: number } | null = null;
  for (const line of text.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm)) {
    const marker = line[1]!;
    if (!open) open = { marker, start: line.index };
    else if (
      marker[0] === open.marker[0] &&
      marker.length >= open.marker.length &&
      !line[2]!.trim()
    ) {
      fences.push([open.start, line.index + line[0].length]);
      open = null;
    }
  }
  if (open) fences.push([open.start, text.length]);
  return fences;
}

export interface ExtractOptions {
  /**
   * Uppercase project parts to ignore when a Jira key appears without a URL.
   * A Jira browse URL still identifies its issue, so a real project sharing a
   * blocked name keeps working through links.
   */
  blockedJiraProjects?: Iterable<string>;
  /**
   * Code fences in `text`'s own offsets. A caller extracting from a slice of a
   * longer message passes the message's fences, since the slice alone cannot
   * tell whether it starts inside one. Computed from `text` when absent.
   */
  fences?: ReadonlyArray<readonly [number, number]>;
}

export function extractIssueReferences(
  text: string,
  options: ExtractOptions = {},
): IssueReference[] {
  const blocked = new Set(
    [...(options.blockedJiraProjects ?? [])].map((name) =>
      name.trim().toUpperCase(),
    ),
  );
  // Example output, fixtures and logs sit in code blocks; a reference there is
  // usually a sample, not the item a conversation is about.
  const fences = options.fences ?? codeFences(text);
  const fenced = (start: number) =>
    fences.some(([a, b]) => start >= a && start < b);
  const refs: IssueReference[] = [];
  const urls: Array<[number, number]> = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"\])]+/g)) {
    const value = match[0].replace(/[.,;:!?]+$/, "");
    const start = match.index;
    urls.push([start, start + match[0].length]);
    const parsed = issueUrl(value);
    if (!parsed) continue;
    const prefix = text.slice(Math.max(0, start - 520), start);
    const label = prefix.match(/\[([^\]\n]{1,512})\]\($/)?.[1];
    // A link into the item (a changed file, a review comment) is labelled for
    // that part, not for the item.
    const part = /\/(?:issues|pull)\/[1-9]\d*\/.|#./.test(value);
    refs.push({
      ...parsed,
      start,
      end: start + value.length,
      title:
        label && !part && !isReferenceLabel(label, parsed.key) ? label : null,
    });
  }
  const enclosed = (start: number) =>
    urls.some(([a, b]) => start >= a && start < b);
  for (const match of text.matchAll(
    // A Jira project key is at least two characters, which keeps `H-1` and
    // other one-letter prose out without consulting any list.
    /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)\b|\b([A-Z][A-Z0-9_]+-[1-9]\d*)\b/g,
  )) {
    if (enclosed(match.index)) continue;
    if (match[3] && blocked.has(match[3].split("-")[0]!)) continue;
    refs.push({
      key: match[3] ?? `${match[1]!.toLowerCase()}#${match[2]}`,
      identity: null,
      url: null,
      provider: match[3] ? "jira" : "github",
      kind: match[3] ? "issue" : "unknown",
      title: null,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  // A bare number needs explicit issue/PR wording and exactly one repository
  // URL in this text window. Never borrow another session's repository.
  const repositories = new Map<string, URL>();
  for (const [start, end] of urls) {
    if (fenced(start)) continue;
    try {
      const url = new URL(text.slice(start, end).replace(/[.,;:!?]+$/, ""));
      const parts = url.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/|$)/);
      if (
        !parts ||
        url.username ||
        url.password ||
        !(url.hostname === "github.com" || url.hostname.startsWith("github."))
      )
        continue;
      url.pathname = `/${parts[1]}/${parts[2]}`.toLowerCase();
      url.search = "";
      url.hash = "";
      repositories.set(`${url.host}${url.pathname}`, url);
    } catch {
      /* Not a repository URL. */
    }
  }
  if (repositories.size === 1) {
    const repository = [...repositories.values()][0]!;
    for (const match of text.matchAll(
      /\b(issue|PR|pull request)\s+#([1-9]\d*)\b/gi,
    )) {
      const start = match.index + match[0].indexOf("#");
      if (enclosed(start)) continue;
      const parsed = issueUrl(
        `${repository.origin}${repository.pathname}/${match[1]!.toLowerCase() === "issue" ? "issues" : "pull"}/${match[2]}`,
      );
      if (parsed)
        refs.push({
          ...parsed,
          contextual: true,
          title: null,
          start,
          end: match.index + match[0].length,
        });
    }
  }
  // A Markdown label containing the same key is one occurrence with its URL.
  return refs.filter(
    (ref) =>
      !fenced(ref.start) &&
      (ref.identity ||
        !refs.some(
          (other) =>
            other.identity &&
            other.key === ref.key &&
            other.start > ref.end &&
            text.slice(ref.end, other.start).match(/^\]\($/),
        )),
  );
}

/** Evidence never retains URL credentials, query tokens or fragment payloads. */
export function issueExcerpt(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"\])]+/g, (value) => {
      try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[URL]";
      }
    })
    .slice(0, 512);
}
