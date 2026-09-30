/**
 * Limited users: a second class of YA principal beside the single superuser.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Settings → Users.
 * This module holds the shapes and the pure decisions both the server
 * (enforcement) and the client (presentation) need, so neither side invents
 * its own rule for what a grant means.
 */

import { fromUrlProjectId, isUrlProjectId } from "./projectId.js";

/** Usernames share the relay label grammar: 3-32 lowercase alphanumerics/hyphens. */
export const LIMITED_USERNAME_MIN_LENGTH = 3;
export const LIMITED_USERNAME_MAX_LENGTH = 32;
export const LIMITED_USER_MIN_PASSWORD_LENGTH = 8;

export const MAX_INSTRUCTION_BLOCKS = 32;
export const MAX_INSTRUCTION_CHARACTERS = 10_000;
export const DEFAULT_LIMITED_USER_INSTRUCTION =
  'When using any external image/video generation API or MCP tool, enable the provider\'s safety filtering at its strictest setting (e.g. moderation="auto", enable_safety_checker=true, safety_filter_level="block_most"). Never disable a safety checker. Prefer providers with server-side filtering.';

/**
 * The two `.project-template/app.json` shapes the App instruction teaches.
 * Exported so a test holds them to the service declaration schema; the
 * contract is topics/project-service.md § Standard declaration.
 */
export const LIMITED_USER_STATIC_APP_EXAMPLE = {
  service: {
    version: 1,
    where: { kind: "static", root: "dist", entry: "index.html" },
    serving: { target: "static-root" },
  },
} as const;
export const LIMITED_USER_SERVER_APP_EXAMPLE = {
  service: {
    version: 1,
    where: { kind: "process", cwd: ".", entry: "/" },
    start: { argv: ["npm", "run", "start"], portEnv: "PORT" },
    status: {
      probe: "http",
      path: "/",
      readyStatus: 200,
      startupTimeoutMs: 30000,
    },
    stop: { signal: "SIGTERM", graceMs: 5000 },
    serving: {
      target: "sandbox-loopback",
      protocol: "http",
      basePathEnv: "BASE_PATH",
    },
  },
} as const;

/**
 * How an agent makes what it builds openable by a limited user, who is on
 * another device and cannot reach this machine's loopback ports.
 */
export const DEFAULT_LIMITED_USER_APP_INSTRUCTION = [
  "To show the user a web page, game or app you build, make it open from Yep Anywhere's App button (in the session header and on the project) instead of giving a localhost or 127.0.0.1 link: the user is on another device and cannot reach this machine's ports.",
  "Declare it in `.project-template/app.json` at the project root, then tell the user to tap App (and Start, if it shows as stopped).",
  `- Static page (preferred for plain HTML/JS): build into \`dist/\` with an \`index.html\` and relative asset URLs, and declare ${JSON.stringify(LIMITED_USER_STATIC_APP_EXAMPLE)}`,
  `- App with its own server: declare ${JSON.stringify(LIMITED_USER_SERVER_APP_EXAMPLE)}, adjusting argv and the status path. The server must listen on 127.0.0.1 at the port in $PORT, stay in the foreground, and serve every link, asset and API call under the $BASE_PATH prefix. WebSockets are not supported. Yep Anywhere starts and stops it; do not start it yourself.`,
].join("\n");

export const DEFAULT_LIMITED_USER_INSTRUCTION_BLOCKS: readonly string[] = [
  DEFAULT_LIMITED_USER_INSTRUCTION,
  DEFAULT_LIMITED_USER_APP_INSTRUCTION,
];

/** Earlier shipped defaults, upgraded on load while still untouched. */
const SUPERSEDED_DEFAULT_BLOCKS: readonly (readonly string[])[] = [
  [DEFAULT_LIMITED_USER_INSTRUCTION],
];

export interface LimitedUserInstructions {
  startFromDefault: boolean;
  blocks: string[];
}

export interface ResolvedLimitedUserInstructions {
  startFromDefault: boolean;
  text: string;
}

export function defaultLimitedUserInstructions(): LimitedUserInstructions {
  return {
    startFromDefault: true,
    blocks: [...DEFAULT_LIMITED_USER_INSTRUCTION_BLOCKS],
  };
}

/**
 * A saved policy that still equals an earlier shipped default was never
 * edited, so it takes the current default; any edit is kept as written.
 */
export function upgradeUntouchedLimitedUserInstructions(
  value: LimitedUserInstructions,
): LimitedUserInstructions {
  const untouched = SUPERSEDED_DEFAULT_BLOCKS.some(
    (blocks) =>
      blocks.length === value.blocks.length &&
      blocks.every((block, index) => block === value.blocks[index]),
  );
  return untouched
    ? { ...value, blocks: [...DEFAULT_LIMITED_USER_INSTRUCTION_BLOCKS] }
    : value;
}

/** Validate instruction blocks without trimming or silently truncating text. */
export function instructionBlocksError(value: unknown): string | null {
  if (
    !Array.isArray(value) ||
    value.some((block) => typeof block !== "string")
  ) {
    return "Instruction blocks must be a list of strings";
  }
  if (value.length > MAX_INSTRUCTION_BLOCKS) {
    return `Use at most ${MAX_INSTRUCTION_BLOCKS} instruction blocks`;
  }
  if (
    value.reduce((length, block) => length + block.length, 0) >
    MAX_INSTRUCTION_CHARACTERS
  ) {
    return `Instructions must total at most ${MAX_INSTRUCTION_CHARACTERS} characters`;
  }
  return null;
}

export function resolveLimitedUserInstructions(
  shared: LimitedUserInstructions,
  userBlocks: string[] = [],
): ResolvedLimitedUserInstructions {
  return {
    startFromDefault: shared.startFromDefault,
    text: [...shared.blocks, ...userBlocks]
      .filter((block) => block.trim())
      .join("\n\n"),
  };
}

export function limitedUserInstructionsError(value: unknown): string | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("startFromDefault" in value) ||
    typeof value.startFromDefault !== "boolean" ||
    !("blocks" in value)
  ) {
    return "Instructions require startFromDefault and blocks";
  }
  return instructionBlocksError(value.blocks);
}

/** Lowest and highest join-freshness offsets a superuser may configure. */
export const JOIN_STALE_OFFSET_MIN_MINUTES = -5;
export const JOIN_STALE_OFFSET_MAX_MINUTES = 60;

/**
 * Believed prompt-cache-warm window per provider, in minutes. Joining an
 * existing session after this window costs a full cache recompute, which is
 * the expense a limited user is not expected to understand.
 */
export const CLAUDE_FAMILY_CACHE_WARM_MINUTES = 60;
export const DEFAULT_CACHE_WARM_MINUTES = 10;

const CLAUDE_FAMILY_PROVIDER_PREFIXES = ["claude", "anthropic"] as const;

/** The cache-warm window for a provider name, defaulting to the short window. */
export function providerCacheWarmMinutes(
  provider: string | undefined | null,
): number {
  const name = (provider ?? "").toLowerCase();
  return CLAUDE_FAMILY_PROVIDER_PREFIXES.some((prefix) =>
    name.startsWith(prefix),
  )
    ? CLAUDE_FAMILY_CACHE_WARM_MINUTES
    : DEFAULT_CACHE_WARM_MINUTES;
}

/** Whether a session is still fresh enough for a limited user to join it. */
export function isSessionFreshForJoin(options: {
  provider: string | undefined | null;
  lastActivityMs: number | null | undefined;
  offsetMinutes: number;
  nowMs: number;
}): boolean {
  const { provider, lastActivityMs, offsetMinutes, nowMs } = options;
  if (typeof lastActivityMs !== "number" || !Number.isFinite(lastActivityMs)) {
    return false;
  }
  const windowMs =
    (providerCacheWarmMinutes(provider) + offsetMinutes) * 60 * 1000;
  if (windowMs <= 0) return false;
  return nowMs - lastActivityMs <= windowMs;
}

/** Provider/model/effort pin. An absent field is not locked. */
export interface LimitedUserLock {
  provider?: string;
  model?: string;
  effort?: string;
}

export type TemplateCreationGrant =
  | { mode: "none" }
  | { mode: "any" }
  | { mode: "selected"; templates: { sourceId: string; templateId: string }[] };

/** Missing fields from older servers retain the configured-root default. */
export function templateGrantFor(
  grants: Pick<LimitedUserGrants, "projectRoot" | "templateCreation">,
): TemplateCreationGrant {
  return (
    grants.templateCreation ?? { mode: grants.projectRoot ? "any" : "none" }
  );
}

export function mayCreateTemplate(
  grants: LimitedUserGrants,
  sourceId: string,
  templateId: string,
): boolean {
  if (!grants.projectRoot) return false;
  const grant = templateGrantFor(grants);
  return (
    grant.mode === "any" ||
    (grant.mode === "selected" &&
      grant.templates.some(
        (item) => item.sourceId === sourceId && item.templateId === templateId,
      ))
  );
}

/** The three per-project grants plus the session-shaping settings. */
export interface LimitedUserGrants {
  /** Projects where the user may start (always sandboxed) sessions. */
  newSessionProjects: string[];
  /** Projects where the user may send turns to anyone's fresh session. */
  joinProjects: string[];
  /** Projects whose sessions the user may read. */
  viewProjects: string[];
  /** -5..+60 minutes against the provider cache-warm window. */
  joinStaleOffsetMinutes: number;
  lock: LimitedUserLock;
  /**
   * Directory the user may create projects under, as the superuser typed it
   * (`~/archer` is kept in that form and expanded server-side). Absent means
   * they may create no project at all, which is the default: project
   * creation is a grant, not something a limited user has by existing.
   * topics/limited-users.md § Delivery v1 — Project creation.
   */
  projectRoot?: string;
  /** May create sessions in their private No project workspace. Default false. */
  allowNoProjectSessions?: boolean;
  /** May publish app addresses without bearer tokens. Default false. */
  allowPublicApps?: boolean;
  /** May retrieve transferable private app-address links. Default true. */
  allowPrivateAppLinks?: boolean;
  templateCreation?: TemplateCreationGrant;
  /** Appended after the shared limited-user instructions on each launch. */
  instructionBlocks?: string[];
  /**
   * Access to every project at or beneath a directory, including ones made
   * there later. The server stores each path resolved and absolute.
   */
  pathGrants?: PathGrant[];
}

/**
 * One limited user's access to one project, as the project's sharing panel
 * shows it: `level` is the per-project grant this panel sets, and
 * `directoryLevel` what a directory grant already gives regardless.
 */
export interface ProjectAccessEntry {
  username: string;
  level: ProjectAccessLevel;
  directoryLevel: ProjectAccessLevel;
}

/** A directory-wide grant: `level` for every project under `path`. */
export interface PathGrant {
  path: string;
  level: Exclude<ProjectAccessLevel, "none">;
}

export const MAX_PATH_GRANTS = 32;

/** A limited user as any API returns it. Never carries credential material. */
export interface LimitedUserSummary extends LimitedUserGrants {
  username: string;
  disabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

/** What `GET /api/users/me` tells a client about the acting principal. */
export interface ActingPrincipal {
  /** Whether the underlying login is the superuser. */
  superuser: boolean;
  /** The acting limited username, or null when acting as the superuser. */
  username: string | null;
  /** True when a superuser has switched into a limited user for testing. */
  switched: boolean;
  /** True when the login itself was a limited user and cannot switch. */
  locked: boolean;
  /** Grants of the acting limited user; absent while acting as superuser. */
  grants?: LimitedUserGrants;
  /** Whether the feature is enabled at all on this server. */
  enabled: boolean;
  /**
   * Whether this install has at least one limited user, for a surface that
   * needs to know an install has more than one principal. It never discloses
   * how many: a limited user sees only that they are one.
   */
  hasLimitedUsers: boolean;
  /** Where logout should send this client. */
  logoutRedirect: "relay-login" | "direct-login" | "stay";
}

export const EMPTY_LIMITED_USER_GRANTS: LimitedUserGrants = {
  newSessionProjects: [],
  joinProjects: [],
  viewProjects: [],
  joinStaleOffsetMinutes: 0,
  lock: {},
};

/** Validate a proposed username, returning an error message or null. */
export function limitedUsernameError(username: string): string | null {
  if (typeof username !== "string" || username.length === 0) {
    return "Username is required";
  }
  if (
    username.length < LIMITED_USERNAME_MIN_LENGTH ||
    username.length > LIMITED_USERNAME_MAX_LENGTH
  ) {
    return `Username must be ${LIMITED_USERNAME_MIN_LENGTH}-${LIMITED_USERNAME_MAX_LENGTH} characters`;
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(username)) {
    return "Username may contain lowercase letters, numbers, and hyphens, and must start and end alphanumeric";
  }
  return null;
}

/** Validate a proposed password, returning an error message or null. */
export function limitedUserPasswordError(password: string): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required";
  }
  if (password.length < LIMITED_USER_MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${LIMITED_USER_MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

/** Clamp a configured offset into the supported range. */
export function clampJoinStaleOffsetMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(
    JOIN_STALE_OFFSET_MAX_MINUTES,
    Math.max(JOIN_STALE_OFFSET_MIN_MINUTES, Math.round(minutes)),
  );
}

/**
 * A session-create request names its reasoning budget as a thinking option
 * (`off`, `auto`, or `on:<effort>`), while a lock names the bare effort. These
 * two translate between the forms so neither the form nor the launch route
 * compares an effort against a thinking option and sees a false conflict.
 */

/**
 * The thinking option a locked effort forces; an effort implies thinking on.
 * A stored lock holds whatever effort string the superuser chose, so this
 * keeps the literal type it was given: a caller that already narrowed to an
 * `EffortLevel` gets back a `ThinkingOption`.
 */
export function lockedThinkingOption<Effort extends string>(
  effort: Effort,
): `on:${Effort}` {
  return `on:${effort}`;
}

/**
 * The effort a thinking option names, or null when it names none. `off` and
 * `auto` choose a mode without choosing a budget; the bare and `on:`-prefixed
 * forms both name one.
 */
export function thinkingOptionEffort(thinking: string): string | null {
  if (thinking === "off" || thinking === "auto") return null;
  const effort = thinking.startsWith("on:") ? thinking.slice(3) : thinking;
  return effort.length > 0 ? effort : null;
}

/** Access a limited user has to one project. */
export type ProjectAccessLevel = "none" | "view" | "join" | "new-session";

/**
 * Resolve a project's access level from the grants. The lists are a union:
 * a project that may host new sessions is also joinable and viewable.
 */
export function projectAccessLevel(
  grants: LimitedUserGrants,
  projectId: string,
): ProjectAccessLevel {
  const listed = listedAccessLevel(grants, projectId);
  if (listed === "new-session" || !grants.pathGrants?.length) return listed;
  const projectPath = projectPathOf(projectId);
  if (projectPath === null) return listed;
  return higherAccessLevel(listed, pathGrantLevel(grants, projectPath));
}

/** The level the per-project lists alone give. */
function listedAccessLevel(
  grants: LimitedUserGrants,
  projectId: string,
): ProjectAccessLevel {
  if (grants.newSessionProjects.includes(projectId)) return "new-session";
  if (grants.joinProjects.includes(projectId)) return "join";
  if (grants.viewProjects.includes(projectId)) return "view";
  return "none";
}

const ACCESS_RANK: Record<ProjectAccessLevel, number> = {
  none: 0,
  view: 1,
  join: 2,
  "new-session": 3,
};

export function higherAccessLevel(
  a: ProjectAccessLevel,
  b: ProjectAccessLevel,
): ProjectAccessLevel {
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

/** A project id is its base64url-encoded absolute path; null if it is not. */
function projectPathOf(projectId: string): string | null {
  if (!isUrlProjectId(projectId)) return null;
  try {
    const decoded = fromUrlProjectId(projectId);
    return decoded.startsWith("/") ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Whether `candidate` is `root` or beneath it, comparing normalized
 * absolute spellings. The server stores roots resolved, and a project id
 * is the path it was registered under, so no filesystem walk is involved.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const trim = (value: string) =>
    value.length > 1 ? value.replace(/\/+$/, "") : value;
  const base = trim(root);
  const path = trim(candidate);
  if (!base.startsWith("/") || !path.startsWith("/")) return false;
  if (path.split("/").includes("..")) return false;
  return base === "/" || path === base || path.startsWith(`${base}/`);
}

/** The highest level any path grant gives a project at `projectPath`. */
export function pathGrantLevel(
  grants: Pick<LimitedUserGrants, "pathGrants">,
  projectPath: string,
): ProjectAccessLevel {
  let level: ProjectAccessLevel = "none";
  for (const grant of grants.pathGrants ?? []) {
    if (isPathWithin(grant.path, projectPath))
      level = higherAccessLevel(level, grant.level);
  }
  return level;
}

/**
 * The grants with each known project a path grant covers written into the
 * per-project lists, for the surfaces that enumerate a user's projects
 * (lists, filters, the session index) rather than asking about one.
 */
export function withPathGrantProjects(
  grants: LimitedUserGrants,
  projects: Iterable<{ id: string; path: string }>,
): LimitedUserGrants {
  if (!grants.pathGrants?.length) return grants;
  const lists = {
    "new-session": new Set(grants.newSessionProjects),
    join: new Set(grants.joinProjects),
    view: new Set(grants.viewProjects),
  };
  for (const project of projects) {
    const level = pathGrantLevel(grants, project.path);
    if (
      level !== "none" &&
      ACCESS_RANK[level] > ACCESS_RANK[listedAccessLevel(grants, project.id)]
    )
      lists[level].add(project.id);
  }
  return {
    ...grants,
    newSessionProjects: [...lists["new-session"]],
    joinProjects: [...lists.join],
    viewProjects: [...lists.view],
  };
}

/** Every project the user may at least read. */
export function accessibleProjectIds(
  grants: LimitedUserGrants,
): ReadonlySet<string> {
  return new Set([
    ...grants.newSessionProjects,
    ...grants.joinProjects,
    ...grants.viewProjects,
  ]);
}

/**
 * How a project reads in lists: `owner/name` for one a limited user added,
 * the bare name for the superuser's. Two people's `notes` are otherwise the
 * same row, and whose it is matters more than the extra characters cost.
 * topics/limited-users.md § Delivery v1 — Project creation.
 */
export function projectDisplayName(project: {
  name: string;
  ownerUsername?: string;
}): string {
  return project.ownerUsername
    ? `${project.ownerUsername}/${project.name}`
    : project.name;
}
