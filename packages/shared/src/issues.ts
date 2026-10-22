/** Experimental, provider-neutral issue/session association contract. */
export interface IssueSettings {
  enabled: boolean;
  scope: "viewed" | "recent";
  recentDays: number;
  /** Subject/body and unavailable-item freshness; null means never expire. */
  contentTtlSeconds?: number | null;
  /** Status freshness, also reserved for future comments; null means never expire. */
  statusCommentTtlSeconds?: number | null;
  /** Absent means discovery never contacts a tracker, the original contract. */
  confirmation?: IssueConfirmationSettings;
  /**
   * Uppercase project parts ignored when a Jira key is seen without a URL.
   * Absent means {@link DEFAULT_JIRA_KEY_BLOCKLIST}; an empty array means none.
   */
  jiraKeyBlocklist?: string[];
  /** Recognize unknown bare ticket keys. Absent/false requires URL evidence. */
  aggressiveMatching?: boolean;
  /** Absent preserves the historical confirmation-enabled status policy. */
  githubStatusEnabled?: boolean;
  /** gh is a fallback unless a named account is explicitly selected. */
  githubCli?: { enabled: boolean; account: string };
}

/** Issue association settings for an installation that has never saved any. */
export const DEFAULT_ISSUE_SETTINGS: IssueSettings = {
  enabled: false,
  scope: "viewed",
  recentDays: 7,
};

export const DEFAULT_ISSUE_CONTENT_TTL_SECONDS = 14 * 86400;
export const DEFAULT_ISSUE_STATUS_COMMENT_TTL_SECONDS = 300;
export const ISSUE_CONTENT_TTL_SECONDS = [
  1,
  60,
  3600,
  86400,
  259200,
  604800,
  1209600,
  2592000,
  7776000,
  null,
] as const;
export const ISSUE_STATUS_COMMENT_TTL_SECONDS = [
  1,
  5,
  15,
  60,
  300,
  900,
  3600,
  21600,
  86400,
  604800,
  null,
] as const;

/**
 * Opt-in tracker confirmation.
 *
 * Text extraction alone cannot tell `PROJ-7` from `UTF-8`, so an installation
 * that has tracker credentials can let YA ask the tracker once whether a newly
 * seen reference is real. Off by default: turning it on is what authorizes
 * outbound requests carrying a credential.
 */
export interface IssueConfirmationSettings {
  enabled: boolean;
  /** Jira site for keys seen without a URL, e.g. https://x.atlassian.net. */
  jiraSite: string;
  /** Jira Cloud account email; the API token is its password. */
  jiraEmail: string;
}

/**
 * Uppercase prose tokens that look exactly like a Jira key before a number.
 *
 * A bare `PROJ-7` is indistinguishable from `UTF-8` by shape alone, and these
 * appear constantly in engineering transcripts. Blocking them applies only to
 * keys seen without a URL: a Jira browse URL still identifies its issue, so a
 * tracker whose real project key is on this list keeps working through links,
 * and an installation can edit the list.
 */
export const DEFAULT_JIRA_KEY_BLOCKLIST = [
  "AES",
  "AGPL",
  "ANSI",
  "BSD",
  "COVID",
  "CVE",
  "CWE",
  "ECMA",
  "EPL",
  "FIPS",
  "GMT",
  "GPL",
  "GPT",
  "IEC",
  "IEEE",
  "ISO",
  "JPEG",
  "LGPL",
  "MPEG",
  "MPL",
  "PEP",
  "RFC",
  "SHA",
  "SOC",
  "SQL",
  "SSH",
  "TLS",
  "USB",
  "UTC",
  "UTF",
  "WCAG",
] as const;

export type IssueCredentialProvider = "github" | "jira";

/** One place a credential can come from, and whether it is there now. */
export interface IssueCredentialSource {
  /** Environment variable name, stored-key label, or CLI command. */
  name: string;
  kind: "stored" | "env" | "cli";
  present: boolean;
}

/** Never carries a key: presence and origin only. */
export interface IssueCredentialStatus {
  provider: IssueCredentialProvider;
  /** Resolution order; the first present source wins. */
  sources: IssueCredentialSource[];
  /** Name of the source a lookup would use now, or null when none is usable. */
  active: string | null;
  /** Non-secret CLI account identity, if known. */
  account?: string;
  accounts?: string[];
}

export interface IssueCredentialsResult {
  credentials: IssueCredentialStatus[];
}
export type IssueSort = "activity" | "mentioned" | "number";

/** What the tracker last said about an item's state, and when it said it. */
export interface IssueTrackerStatus {
  state: "open" | "draft" | "merged" | "closed";
  /** ISO time of the lookup that produced this state. */
  checkedAt: string;
  nodeId?: string;
  mergedAt?: string;
  mergeCommitSha?: string;
}

export interface IssueItem {
  id: string;
  key: string;
  title: string | null;
  url: string | null;
  provider: string;
  kind: string;
  sessionCount: number;
  lastSessionActivityAt?: string | null;
  lastMentionAt?: string | null;
  unresolved: boolean;
  /**
   * What the tracker said when this reference was first seen, when
   * confirmation is on. Absent means nothing was ever asked.
   */
  confirmation?: {
    state: "pending" | "confirmed" | "rejected" | "unreachable";
    /** The tracker's own summary, present only for a confirmed reference. */
    title: string | null;
  };
  /**
   * Open, draft, merged or closed, as last read from the tracker. Absent when
   * the server has none to report, including every server before it was added.
   */
  trackerStatus?: IssueTrackerStatus;
}
export interface IssueEvidence {
  id: number;
  sessionId: string;
  projectId: string;
  messageId: string;
  excerpt: string;
  value: string;
  kind: string;
  observedAt: number;
  sourceTime: string | null;
  sourceAvailable?: boolean;
  sessionTitle?: string;
  state: string;
}
export interface KnownJiraProject {
  prefix: string;
  site: string;
}
export interface IssueSession {
  sessionId: string;
  projectId: string;
  title?: string;
  updatedAt?: string;
  createdAt?: string;
  provider?: import("./types.js").ProviderName;
  projectName?: string;
  initialPrompt?: string | null;
  model?: string;
  ownership?: import("./app-types.js").SessionOwnership;
  activity?: import("./app-types.js").AgentActivity;
  lastAgentText?: string | null;
  sourceAvailable?: boolean;
  state: string;
  evidenceCount: number;
  evidence: IssueEvidence[];
}
export interface IssueSessionsResult {
  sessions: IssueSession[];
  nextOffset: number | null;
}
export interface IssueCoverage {
  knownJiraProjects?: KnownJiraProject[];
  settings: IssueSettings;
  active: boolean;
  error: string | null;
  counts: Array<{ state: string; count: number }>;
}
export interface IssueSearchResult {
  /** Presence advertises subject/body refresh and cached content endpoints. */
  contentRefresh?: {
    active: boolean;
    checked: number;
    skipped: number;
    failed: number;
    error: string | null;
  };
  /** Absent on earlier experimental servers; do not offer unsupported sorting. */
  supportedSorts?: IssueSort[];
  sort?: IssueSort | "key";
  /**
   * Canonical identity an exact `ref` lookup matched against. Absent when the
   * server ignored `ref` (earlier servers): the items are then a `q` search,
   * and a caller wanting one issue keeps only `item.id === identity`.
   */
  ref?: string;
  items: IssueItem[];
  /**
   * True while a tracker status refresh covering these items is in flight, so
   * reading again shortly will show fresher states.
   */
  statusRefreshing?: boolean;
  coverage: IssueCoverage;
  nextOffset: number | null;
}
export interface IssueEvidenceResult {
  evidence: IssueEvidence[];
  nextOffset: number | null;
}

/** A tracker item named by a URL, in its canonical stored form. */
export interface IssueUrlReference {
  key: string;
  /** Equal to the server's `IssueItem.id` for a resolved item. */
  identity: string;
  url: string;
  provider: "jira" | "github";
  kind: "issue" | "pr";
}

/** Canonical form of a GitHub issue/PR or Jira browse URL, or null. */
export function issueUrl(value: string): IssueUrlReference | null {
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

/**
 * The item a browser tab is showing. Beyond {@link issueUrl}, a Jira board,
 * backlog or search page names its open issue in `selectedIssue`. Lookup only:
 * transcript extraction keeps `issueUrl`, so indexed evidence is unchanged.
 */
export function issueLookupUrl(value: string): IssueUrlReference | null {
  const direct = issueUrl(value);
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const selected = url.searchParams.get("selectedIssue");
  if (!selected || !/^[A-Z][A-Z0-9_]*-[1-9]\d*$/i.test(selected)) return null;
  // Jira Cloud and Server app paths sit under the site's context path.
  const context = url.pathname.match(/^(.*?)\/(?:jira|secure|projects)\//);
  return issueUrl(`${url.origin}${context?.[1] ?? ""}/browse/${selected}`);
}
