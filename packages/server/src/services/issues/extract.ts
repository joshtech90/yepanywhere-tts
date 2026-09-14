/** Deterministic references; no tracker calls, registry prerequisite or Git access. */
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

export function issueUrl(
  value: string,
): Omit<IssueReference, "start" | "end" | "title"> | null {
  if (value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  const host = url.host.toLowerCase();
  const github = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/(issues|pull)\/([1-9]\d*)(?:\/.*)?$/,
  );
  if (
    github &&
    (url.hostname === "github.com" ||
      github[3] === "pull" ||
      url.hostname.startsWith("github."))
  ) {
    const repository = `${github[1]}/${github[2]}`.toLowerCase();
    const number = github[4];
    const kind = github[3] === "pull" ? "pr" : "issue";
    return {
      key: `${repository}#${number}`,
      identity: `github:${host}:${repository}:${number}`,
      url: `${url.protocol}//${host}/${repository}/${github[3]}/${number}`,
      provider: "github",
      kind,
    };
  }
  const jira = url.pathname.match(
    /^(.*?)\/browse\/([A-Z][A-Z0-9_]*-[1-9]\d*)\/?$/i,
  );
  if (jira) {
    const key = jira[2]!.toUpperCase();
    // Jira deployments can use a context path; it participates in tenant identity.
    const base = `${host}${jira[1]}`;
    return {
      key,
      identity: `jira:${base}:${key}`,
      url: `${url.protocol}//${base}/browse/${key}`,
      provider: "jira",
      kind: "issue",
    };
  }
  return null;
}

export interface ExtractOptions {
  /**
   * Uppercase project parts to ignore when a Jira key appears without a URL.
   * A Jira browse URL still identifies its issue, so a real project sharing a
   * blocked name keeps working through links.
   */
  blockedJiraProjects?: Iterable<string>;
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
    refs.push({
      ...parsed,
      start,
      end: start + value.length,
      title: label && label !== parsed.key ? label : null,
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
      ref.identity ||
      !refs.some(
        (other) =>
          other.identity &&
          other.key === ref.key &&
          other.start > ref.end &&
          text.slice(ref.end, other.start).match(/^\]\($/),
      ),
  );
}

export interface IssueText {
  id: string;
  sourceId?: string;
  text: string;
  timestamp?: string;
}

/** Accept only visible text blocks; tool output, reasoning and setup never enter SQLite. */
export function visibleIssueText(message: {
  uuid?: string;
  id?: unknown;
  type: string;
  content?: unknown;
  message?: { content?: unknown };
  isMeta?: boolean;
  isSynthetic?: boolean;
  timestamp?: string;
}): IssueText | null {
  if (
    !["user", "assistant"].includes(message.type) ||
    message.isMeta ||
    message.isSynthetic
  )
    return null;
  const id =
    message.uuid ?? (typeof message.id === "string" ? message.id : undefined);
  if (!id) return null;
  const content = message.message?.content ?? message.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .flatMap((block) =>
              block && block.type === "text" && typeof block.text === "string"
                ? [block.text]
                : [],
            )
            .join("\n")
        : "";
  if (
    !text ||
    /^(?:# AGENTS\.md instructions|<environment_context>|<INSTRUCTIONS>)/.test(
      text.trim(),
    )
  )
    return null;
  return { id, text, timestamp: message.timestamp };
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
