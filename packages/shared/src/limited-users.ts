/**
 * Limited users: a second class of YA principal beside the single superuser.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Settings → Users.
 * This module holds the shapes and the pure decisions both the server
 * (enforcement) and the client (presentation) need, so neither side invents
 * its own rule for what a grant means.
 */

/** Usernames share the relay label grammar: 3-32 lowercase alphanumerics/hyphens. */
export const LIMITED_USERNAME_MIN_LENGTH = 3;
export const LIMITED_USERNAME_MAX_LENGTH = 32;
export const LIMITED_USER_MIN_PASSWORD_LENGTH = 8;

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
}

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
   * Whether this install has at least one limited user. The sidebar's Users
   * shortcut appears only then, so turning the feature on does not by itself
   * put an account control in front of a single-user install. It never
   * discloses how many: a limited user sees only that they are one.
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
  if (grants.newSessionProjects.includes(projectId)) return "new-session";
  if (grants.joinProjects.includes(projectId)) return "join";
  if (grants.viewProjects.includes(projectId)) return "view";
  return "none";
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
