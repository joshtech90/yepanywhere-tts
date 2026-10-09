/**
 * Per-user usage: what each principal on this install actually did.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage.
 *
 * The aggregation is pure so the server and its tests agree on what a number
 * means, and so "interaction time" has one definition rather than a plausible
 * one per caller.
 */

import {
  equivalentOutputTokens,
  findModelPrices,
  tokenCostUsd,
  unlistedEquivalentOutputTokens,
} from "./model-prices.js";

/** A user is presumed away this long after their last recorded action. */
export const USAGE_AFK_AFTER_MS = 5 * 60 * 1000;

/**
 * What one recorded action was. `session` and `turn` are things the user did;
 * `tokens` is what a provider then charged for that work, which is nobody's
 * action and so feeds no count of actions and no interaction time.
 */
export type UsageEventKind = "session" | "turn" | "tokens";

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
  /** Model short name (the launch alias, e.g. `opus`), for `tokens`. */
  m?: string;
  /**
   * Resolved provider model id, for `tokens` — what the price table is keyed
   * by. Distinct from `m`, which is the alias the table never knows and the
   * report groups by. Absent when the provider never reported one, which
   * leaves the charge unpriced rather than mispriced.
   */
  d?: string;
  /** Project name, for `tokens`. */
  p?: string;
  /** Provider name, for `tokens`: which price list the counts are read under. */
  v?: string;
  /**
   * Present and 1 when the requests in this record were in the long-context
   * tier, for `tokens`. Absent means the standard tier. A tier is a separate
   * record rather than a separate field per class, so an install that never
   * uses a long-context model pays nothing for the distinction.
   */
  x?: 1;
  /** Uncached prompt tokens, for `tokens`. */
  i?: number;
  /** Cache-read prompt tokens, for `tokens`. */
  r?: number;
  /** Cache-write prompt tokens, for `tokens`. */
  c?: number;
  /** Tokens the provider generated, for `tokens`. */
  o?: number;
}

/**
 * The four token classes, kept apart because they do not cost the same: a
 * cache read is a tenth of a fresh prompt token and a fiftieth of an output
 * token. One summed "tokens" number would put a cheap re-read of a long
 * context on the same footing as generation, and report a session as costing
 * an order of magnitude more than it did.
 */
export interface UsageTokenClasses {
  /** Prompt tokens the provider actually processed. */
  freshInputTokens: number;
  /** Prompt tokens served from the provider's cache. */
  cachedInputTokens: number;
  /** Prompt tokens written into that cache. */
  cacheWriteTokens: number;
  outputTokens: number;
}

/**
 * Counts that share one price list: one provider, one context tier. Cost is
 * only defined per bin, because the weights differ by provider and the
 * long-context tier multiplies them — so the ledger bins the raw counts and
 * the weighting happens on the way out, where a corrected price list still
 * reaches records already written.
 */
export interface UsageTokenBin extends UsageTokenClasses {
  /** Provider name as the process reported it; empty when unknown. */
  provider: string;
  /** Resolved provider model id, which the price table is keyed by. */
  modelId: string;
  /** Whether these requests were in the provider's long-context tier. */
  longContext: boolean;
}

/** Tokens charged under one name — one model, or one project. */
export interface UsageTokenBucket {
  /** Model short name or project name; empty when the recorder knew neither. */
  name: string;
  /** Raw counts, summed across every bin. Not comparable as a cost. */
  tokens: UsageTokenClasses;
  /**
   * The bucket's four classes weighted into one unit: **standard-context-tier
   * output tokens of this model**. The headline cost number, because it keeps
   * meaning the same thing when a price changes.
   *
   * **Null when the bucket spans models that price output differently**, as a
   * per-project bucket generally does: one model's output token is not
   * another's, so the sum would not be a quantity. Null says "not expressible
   * in one model's tokens" — read `costUsd` there instead. Also null when no
   * price is known for the bucket's models at all.
   */
  equivalentOutputTokens: number | null;
  /**
   * The same cost in US dollars, which does add across models. A supplement to
   * the equivalent above, not a second opinion: both come from one calculation
   * over one price table.
   *
   * **Null when any part of the bucket is unpriced** — a model the vendored
   * table does not name. A partial dollar figure would read as the whole cost
   * and silently omit the rest.
   */
  costUsd: number | null;
}

export const EMPTY_USAGE_TOKEN_CLASSES: UsageTokenClasses = {
  freshInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
};

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
  /**
   * Raw counts across every provider request this principal's work caused.
   * A volume, not a cost: the classes cost between a fiftieth and one times
   * each other, so this number is for "how much went through", and the
   * per-model split below is what a reader compares.
   */
  tokens: UsageTokenClasses;
  /**
   * The same tokens split by model and, separately, by project — never by the
   * two together, which multiplies rows without answering a question anybody
   * asked. Costliest first.
   */
  byModel: UsageTokenBucket[];
  byProject: UsageTokenBucket[];
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
  tokens: EMPTY_USAGE_TOKEN_CLASSES,
  byModel: [],
  byProject: [],
};

/**
 * One bin's cost, both ways: in standard-tier output tokens of its own model,
 * and in dollars. Null for each when the vendored price table does not name
 * the bin's model — an unpriced charge is reported as unpriced rather than
 * folded in at a guessed rate.
 */
export function binCost(bin: UsageTokenBin): {
  /** Always available: an unlisted model falls back to generic ratios. */
  equivalentOutputTokens: number | null;
  /** Null for a model the vendored price table does not name. */
  costUsd: number | null;
  /**
   * What "one output token" means here, so two bins are only summed when it
   * means the same thing. A priced model's unit is its output price — two
   * ids at one price, such as a dated variant and its alias, are one unit.
   * An unpriced model's unit is the model itself, there being no price to
   * compare.
   */
  unit: string;
} {
  const options = {
    provider: bin.provider,
    model: bin.modelId,
    longContext: bin.longContext,
  };
  const prices = findModelPrices(bin.provider, bin.modelId);
  if (!prices) {
    return {
      equivalentOutputTokens: unlistedEquivalentOutputTokens(bin),
      costUsd: null,
      unit: `model:${bin.provider}/${bin.modelId}`,
    };
  }
  return {
    equivalentOutputTokens: equivalentOutputTokens(bin, prices, options),
    costUsd: tokenCostUsd(bin, prices, options),
    unit: `output-usd:${prices.output}`,
  };
}

/** Raw token volume, every class at face value. Deliberately not a cost. */
export function rawTokenCount(classes: UsageTokenClasses): number {
  return (
    classes.freshInputTokens +
    classes.cachedInputTokens +
    classes.cacheWriteTokens +
    classes.outputTokens
  );
}

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
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Calendar days the ledger spans, counting both ends: a ledger that starts
 * yesterday evening and reaches this morning covers two days. Calendar rather
 * than elapsed-duration, because the reader's question is which days are in
 * here, and a 30-hour ledger spanning three dates is not "1 day".
 *
 * Local dates, because the reader's calendar is the one on their screen. Zero
 * when nothing is recorded.
 */
export function coveredCalendarDays(since: number | null, now: number): number {
  if (since === null || !Number.isFinite(since)) return 0;
  const midnight = (ms: number) => {
    const date = new Date(ms);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const span = midnight(now) - midnight(since);
  return Math.max(1, Math.round(span / DAY_MS) + 1);
}

/** A token count as the ledger may hold it: absent, negative and NaN all zero. */
function countedTokens(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/** Bins accumulated under one name, plus their running raw and cost sums. */
interface BucketAccumulator {
  name: string;
  bins: Map<string, UsageTokenBin>;
}

/** One bin per price list: provider, model and context tier together. */
function bucketKey(
  provider: string,
  modelId: string,
  longContext: boolean,
): string {
  return [provider, modelId, longContext ? "1" : "0"].join("\u0000");
}

/** Add one ledger record's counts into the bin sharing its price list. */
function addToBucket(
  buckets: Map<string, BucketAccumulator>,
  name: string,
  identity: { provider: string; modelId: string; longContext: boolean },
  classes: UsageTokenClasses,
): void {
  const bucket = buckets.get(name) ?? { name, bins: new Map() };
  const key = bucketKey(
    identity.provider,
    identity.modelId,
    identity.longContext,
  );
  const bin = bucket.bins.get(key) ?? {
    ...identity,
    ...EMPTY_USAGE_TOKEN_CLASSES,
  };
  bin.freshInputTokens += classes.freshInputTokens;
  bin.cachedInputTokens += classes.cachedInputTokens;
  bin.cacheWriteTokens += classes.cacheWriteTokens;
  bin.outputTokens += classes.outputTokens;
  bucket.bins.set(key, bin);
  buckets.set(name, bucket);
}

/**
 * Sum a bucket's bins into the numbers the report shows.
 *
 * Dollars add across models, so they are reported whenever every bin is
 * priced. Output-token equivalents only add while the bins share one
 * dollars-per-output-token constant — true of a bucket named by one model,
 * generally false of one named by a project — so they are reported only then,
 * rather than summing quantities that are not in the same unit.
 */
function settleBucket(bucket: BucketAccumulator): UsageTokenBucket {
  const tokens = { ...EMPTY_USAGE_TOKEN_CLASSES };
  let costUsd: number | null = 0;
  let equivalent: number | null = 0;
  let unit: string | null = null;
  for (const bin of bucket.bins.values()) {
    tokens.freshInputTokens += bin.freshInputTokens;
    tokens.cachedInputTokens += bin.cachedInputTokens;
    tokens.cacheWriteTokens += bin.cacheWriteTokens;
    tokens.outputTokens += bin.outputTokens;
    const cost = binCost(bin);
    // An unpriced bin costs the bucket its dollar figure, which is simply not
    // shown then, but not its output-token equivalent.
    if (cost.costUsd === null) costUsd = null;
    else if (costUsd !== null) costUsd += cost.costUsd;
    if (equivalent === null || cost.equivalentOutputTokens === null) {
      equivalent = null;
      continue;
    }
    unit ??= cost.unit;
    if (unit !== cost.unit) {
      // Two units: adding these counts would not yield a quantity.
      equivalent = null;
      continue;
    }
    equivalent += cost.equivalentOutputTokens;
  }
  return {
    name: bucket.name,
    tokens,
    equivalentOutputTokens: equivalent,
    costUsd,
  };
}

/**
 * Buckets costliest-first, so the table's first line is the biggest cost. An
 * unpriced bucket has no cost to rank by, so it sorts after the priced ones,
 * among themselves by raw volume.
 */
function rankBuckets(
  buckets: Map<string, BucketAccumulator>,
): UsageTokenBucket[] {
  return [...buckets.values()].map(settleBucket).sort((a, b) => {
    if (a.costUsd !== null && b.costUsd !== null) {
      if (a.costUsd !== b.costUsd) return b.costUsd - a.costUsd;
    } else if (a.costUsd !== null) {
      return -1;
    } else if (b.costUsd !== null) {
      return 1;
    } else {
      const volume = rawTokenCount(b.tokens) - rawTokenCount(a.tokens);
      if (volume !== 0) return volume;
    }
    return a.name.localeCompare(b.name);
  });
}

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
      totalByModel: Map<string, BucketAccumulator>;
      totalByProject: Map<string, BucketAccumulator>;
      weekByModel: Map<string, BucketAccumulator>;
      weekByProject: Map<string, BucketAccumulator>;
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
        totalByModel: new Map(),
        totalByProject: new Map(),
        weekByModel: new Map(),
        weekByProject: new Map(),
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
    if (event.k === "tokens") {
      // Provider cost, not a user action: no stamp, so interaction time and
      // the action counts stay exactly what the user themselves did.
      const classes: UsageTokenClasses = {
        freshInputTokens: countedTokens(event.i),
        cachedInputTokens: countedTokens(event.r),
        cacheWriteTokens: countedTokens(event.c),
        outputTokens: countedTokens(event.o),
      };
      const identity = {
        provider: event.v ?? "",
        modelId: event.d ?? "",
        longContext: event.x === 1,
      };
      // Group by the model that served the requests, not the launch alias
      // ("opus"), so one model reads as one row whatever it was selected as;
      // a dated snapshot id joins its model's row. Records predating the
      // served id fall back to the alias.
      const servedModel = (event.d || event.m || "").replace(/-\d{8}$/u, "");
      addToBucket(entry.totalByModel, servedModel, identity, classes);
      addToBucket(entry.totalByProject, event.p ?? "", identity, classes);
      if (inLastWeek) {
        addToBucket(entry.weekByModel, servedModel, identity, classes);
        addToBucket(entry.weekByProject, event.p ?? "", identity, classes);
      }
      continue;
    }
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

  /**
   * The by-model and by-project splits are two views of one set of records, so
   * the window's own raw and cost totals come from either — by model, here.
   */
  const windowTotals = (
    base: UsageTotals,
    activeMs: number,
    byModel: UsageTokenBucket[],
    byProject: UsageTokenBucket[],
  ): UsageTotals => {
    const tokens = { ...EMPTY_USAGE_TOKEN_CLASSES };
    for (const bucket of byModel) {
      tokens.freshInputTokens += bucket.tokens.freshInputTokens;
      tokens.cachedInputTokens += bucket.tokens.cachedInputTokens;
      tokens.cacheWriteTokens += bucket.tokens.cacheWriteTokens;
      tokens.outputTokens += bucket.tokens.outputTokens;
    }
    return { ...base, activeMs, tokens, byModel, byProject };
  };

  const users: UserUsage[] = [...keyed.values()].map((entry) => ({
    username: entry.username,
    total: windowTotals(
      entry.total,
      presumedActiveMs(entry.totalStamps),
      rankBuckets(entry.totalByModel),
      rankBuckets(entry.totalByProject),
    ),
    lastWeek: windowTotals(
      entry.lastWeek,
      presumedActiveMs(entry.weekStamps),
      rankBuckets(entry.weekByModel),
      rankBuckets(entry.weekByProject),
    ),
  }));

  return { users, since, now };
}
