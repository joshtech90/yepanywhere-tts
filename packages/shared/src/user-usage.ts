/**
 * Per-user usage: what each principal on this install actually did.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage.
 *
 * The aggregation is pure so the server and its tests agree on what a number
 * means, and so "interaction time" has one definition rather than a plausible
 * one per caller.
 */

/** A user is presumed away this long after their last recorded action. */
export const USAGE_AFK_AFTER_MS = 5 * 60 * 1000;

/** What one recorded action was. */
export type UsageEventKind = "session" | "turn";

/**
 * One thing a principal did, as the ledger stores it. Short keys because
 * every user turn appends one line for the life of the install.
 */
export interface UsageEvent {
  /** Epoch ms. */
  t: number;
  /** Username; absent means the superuser. */
  u?: string;
  k: UsageEventKind;
  /** Words in the user's text, for a turn. */
  w?: number;
}

/** Usage for one principal over one window. */
export interface UsageTotals {
  sessions: number;
  turns: number;
  words: number;
  /**
   * Time the user is presumed present: the union of `USAGE_AFK_AFTER_MS`
   * windows opened by each of their actions. One lone turn therefore counts
   * five minutes, and turns two minutes apart count as continuous rather
   * than as two separate stretches.
   */
  activeMs: number;
}

export interface UserUsage {
  /** Username, or null for the superuser. */
  username: string | null;
  total: UsageTotals;
  /** The same totals restricted to the last seven days. */
  lastWeek: UsageTotals;
}

export interface UsageReport {
  users: UserUsage[];
  /** Epoch ms of the earliest event, or null when nothing is recorded. */
  since: number | null;
  /** Epoch ms the report was computed for. */
  now: number;
}

export const EMPTY_USAGE_TOTALS: UsageTotals = {
  sessions: 0,
  turns: 0,
  words: 0,
  activeMs: 0,
};

/** Words in a user's turn: whitespace-separated tokens, attachments aside. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Presumed-present time for one principal's actions: the union of the
 * `USAGE_AFK_AFTER_MS` window each action opens. Events need not be sorted.
 */
export function presumedActiveMs(timestamps: readonly number[]): number {
  if (timestamps.length === 0) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let total = 0;
  let windowStart = sorted[0] as number;
  let windowEnd = windowStart + USAGE_AFK_AFTER_MS;
  for (const timestamp of sorted.slice(1)) {
    if (timestamp <= windowEnd) {
      // Still present: extend rather than open a second stretch.
      windowEnd = timestamp + USAGE_AFK_AFTER_MS;
      continue;
    }
    total += windowEnd - windowStart;
    windowStart = timestamp;
    windowEnd = timestamp + USAGE_AFK_AFTER_MS;
  }
  return total + (windowEnd - windowStart);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Aggregate a ledger into per-principal totals. `knownUsernames` seeds the
 * report so a user who has done nothing yet still appears with zeroes; the
 * superuser is always included.
 */
export function summarizeUsage(
  events: readonly UsageEvent[],
  options: { now: number; knownUsernames?: readonly string[] },
): UsageReport {
  const { now, knownUsernames = [] } = options;
  const lastWeekStart = now - WEEK_MS;
  // null keys the superuser; a Map keeps the seeded order stable.
  const keyed = new Map<
    string,
    {
      username: string | null;
      total: UsageTotals;
      lastWeek: UsageTotals;
      totalStamps: number[];
      weekStamps: number[];
    }
  >();

  const ensure = (username: string | null) => {
    const key = username ?? "";
    let entry = keyed.get(key);
    if (!entry) {
      entry = {
        username,
        total: { ...EMPTY_USAGE_TOTALS },
        lastWeek: { ...EMPTY_USAGE_TOTALS },
        totalStamps: [],
        weekStamps: [],
      };
      keyed.set(key, entry);
    }
    return entry;
  };

  ensure(null);
  for (const username of knownUsernames) ensure(username);

  let since: number | null = null;
  for (const event of events) {
    if (!Number.isFinite(event.t)) continue;
    since = since === null ? event.t : Math.min(since, event.t);
    const entry = ensure(event.u ?? null);
    const inLastWeek = event.t >= lastWeekStart;
    const words = typeof event.w === "number" && event.w > 0 ? event.w : 0;
    entry.totalStamps.push(event.t);
    if (inLastWeek) entry.weekStamps.push(event.t);
    if (event.k === "session") {
      entry.total.sessions += 1;
      if (inLastWeek) entry.lastWeek.sessions += 1;
      continue;
    }
    entry.total.turns += 1;
    entry.total.words += words;
    if (inLastWeek) {
      entry.lastWeek.turns += 1;
      entry.lastWeek.words += words;
    }
  }

  const users: UserUsage[] = [...keyed.values()].map((entry) => ({
    username: entry.username,
    total: { ...entry.total, activeMs: presumedActiveMs(entry.totalStamps) },
    lastWeek: {
      ...entry.lastWeek,
      activeMs: presumedActiveMs(entry.weekStamps),
    },
  }));

  return { users, since, now };
}
