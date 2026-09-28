import { describe, expect, it } from "vitest";
import {
  USAGE_AFK_AFTER_MS,
  countWords,
  coveredCalendarDays,
  presumedActiveMs,
  summarizeUsage,
  type UsageEvent,
} from "../user-usage.js";

/** Contract: topics/limited-users.md § Delivery v1 — Usage. */

const MINUTE = 60 * 1000;

describe("countWords", () => {
  it("counts whitespace-separated tokens and ignores empty text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords(" two  words\nhere ")).toBe(3);
  });
});

describe("presumedActiveMs", () => {
  it("credits a lone action the whole away-after window", () => {
    expect(presumedActiveMs([1000])).toBe(USAGE_AFK_AFTER_MS);
  });

  it("treats actions inside the window as one continuous stretch", () => {
    // Two turns two minutes apart: present from the first until five
    // minutes after the second, not two separate five-minute stretches.
    expect(presumedActiveMs([0, 2 * MINUTE])).toBe(
      2 * MINUTE + USAGE_AFK_AFTER_MS,
    );
  });

  it("starts a new stretch once the user is presumed away", () => {
    expect(presumedActiveMs([0, 60 * MINUTE])).toBe(2 * USAGE_AFK_AFTER_MS);
  });

  it("does not care about input order", () => {
    expect(presumedActiveMs([60 * MINUTE, 0])).toBe(2 * USAGE_AFK_AFTER_MS);
  });

  it("is zero with nothing recorded", () => {
    expect(presumedActiveMs([])).toBe(0);
  });
});

describe("summarizeUsage", () => {
  const now = 100 * 24 * 60 * MINUTE;
  const daysAgo = (days: number) => now - days * 24 * 60 * MINUTE;

  const events: UsageEvent[] = [
    { t: daysAgo(30), k: "session" },
    { t: daysAgo(30), k: "turn", w: 10 },
    { t: daysAgo(2), k: "turn", w: 5, u: "archer" },
    { t: daysAgo(2), k: "session", u: "archer" },
    { t: daysAgo(20), k: "turn", w: 100, u: "archer" },
  ];

  it("separates the superuser from named users", () => {
    const report = summarizeUsage(events, { now });
    const superuser = report.users.find((user) => user.username === null);
    const archer = report.users.find((user) => user.username === "archer");
    expect(superuser?.total).toMatchObject({
      sessions: 1,
      turns: 1,
      words: 10,
    });
    expect(archer?.total).toMatchObject({ sessions: 1, turns: 2, words: 105 });
  });

  it("restricts the last-week column to the last seven days", () => {
    const report = summarizeUsage(events, { now });
    const archer = report.users.find((user) => user.username === "archer");
    expect(archer?.lastWeek).toMatchObject({
      sessions: 1,
      turns: 1,
      words: 5,
    });
    const superuser = report.users.find((user) => user.username === null);
    expect(superuser?.lastWeek).toMatchObject({
      sessions: 0,
      turns: 0,
      words: 0,
    });
  });

  it("reports how far back the ledger reaches", () => {
    expect(summarizeUsage(events, { now }).since).toBe(daysAgo(30));
    expect(summarizeUsage([], { now }).since).toBeNull();
  });

  it("lists a known user who has done nothing, and always the superuser", () => {
    const report = summarizeUsage([], {
      now,
      knownUsernames: ["archer", "lana"],
    });
    expect(report.users.map((user) => user.username)).toEqual([
      null,
      "archer",
      "lana",
    ]);
    for (const user of report.users) {
      expect(user.total).toMatchObject({ sessions: 0, turns: 0, words: 0 });
    }
  });

  it("ignores a record with no usable timestamp", () => {
    const report = summarizeUsage(
      [{ t: Number.NaN, k: "turn", w: 3 } as UsageEvent],
      { now },
    );
    expect(report.since).toBeNull();
    expect(report.users[0]?.total.turns).toBe(0);
  });

  describe("token charges", () => {
    /** Opus and Sonnet on Claude, over two projects, all standard tier. */
    const tokenEvents: UsageEvent[] = [
      { t: daysAgo(20), k: "turn", w: 4, u: "archer" },
      {
        t: daysAgo(20),
        k: "tokens",
        u: "archer",
        m: "opus",
        d: "claude-opus-4-5",
        v: "claude",
        p: "ya",
        i: 1000,
        r: 9000,
        c: 500,
        o: 2000,
      },
      {
        t: daysAgo(2),
        k: "tokens",
        u: "archer",
        m: "sonnet",
        d: "claude-sonnet-4-5",
        v: "claude",
        p: "site",
        i: 100,
        o: 50,
      },
    ];

    const archerOf = (events: UsageEvent[]) =>
      summarizeUsage(events, { now }).users.find(
        (user) => user.username === "archer",
      );

    it("sums the four classes apart, over the window", () => {
      expect(archerOf(tokenEvents)?.total.tokens).toEqual({
        freshInputTokens: 1100,
        cachedInputTokens: 9000,
        cacheWriteTokens: 500,
        outputTokens: 2050,
      });
      expect(archerOf(tokenEvents)?.lastWeek.tokens).toEqual({
        freshInputTokens: 100,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 50,
      });
    });

    // Rows are named by the model that served the requests, not the alias.
    const opusOf = (events: UsageEvent[]) =>
      archerOf(events)?.total.byModel.find(
        (bucket) => bucket.name === "claude-opus-4-5",
      );

    it("prices a model bucket in its own output tokens and in dollars", () => {
      const opus = opusOf(tokenEvents);
      // Opus 4.5 is $5/$25/$0.50/$6.25 per million. So
      // 1000*5 + 9000*0.5 + 500*6.25 + 2000*25 = 62,625 dollar-microunits,
      // i.e. $0.062625, which at $25/M output is 2505 output tokens.
      expect(opus?.costUsd).toBeCloseTo(0.062625, 9);
      expect(opus?.equivalentOutputTokens).toBe(2505);
    });

    it("relates the two by exactly the model's output price", () => {
      const opus = opusOf(tokenEvents);
      const outputPricePerToken = 25 / 1_000_000;
      expect(opus?.equivalentOutputTokens).toBe(
        Math.round((opus?.costUsd ?? 0) / outputPricePerToken),
      );
    });

    it("ranks buckets costliest first", () => {
      expect(
        archerOf(tokenEvents)?.total.byModel.map((bucket) => bucket.name),
      ).toEqual(["claude-opus-4-5", "claude-sonnet-4-5"]);
    });

    it("gives a cross-model project bucket dollars but no output equivalent", () => {
      // One project, two models: dollars add, output tokens are two units.
      const mixed: UsageEvent[] = [
        { ...(tokenEvents[1] as UsageEvent), p: "ya" },
        { ...(tokenEvents[2] as UsageEvent), p: "ya" },
      ];
      const ya = archerOf(mixed)?.total.byProject.find(
        (bucket) => bucket.name === "ya",
      );
      expect(ya?.equivalentOutputTokens).toBeNull();
      expect(ya?.costUsd).toBeCloseTo(0.062625 + (100 * 3 + 50 * 15) / 1e6, 9);
    });

    it("keeps one model's dated id and its alias as one unit", () => {
      const sameModel: UsageEvent[] = [
        {
          t: daysAgo(3),
          k: "tokens",
          m: "opus",
          d: "claude-opus-4-5",
          v: "claude",
          o: 100,
        },
        {
          t: daysAgo(3),
          k: "tokens",
          m: "opus",
          d: "claude-opus-4-5-20251101",
          v: "claude",
          o: 100,
        },
      ];
      const opus = summarizeUsage(sameModel, { now }).users[0]?.total
        .byModel[0];
      expect(opus?.equivalentOutputTokens).toBe(200);
    });

    it("prices an unlisted model in output tokens but not in dollars", () => {
      const local: UsageEvent[] = [
        {
          t: daysAgo(3),
          k: "tokens",
          m: "qwen-local",
          d: "qwen3-coder-local",
          v: "opencode",
          i: 5500,
          o: 100,
        },
      ];
      const bucket = summarizeUsage(local, { now }).users[0]?.total.byModel[0];
      // 5500 fresh prompt tokens at 1/5.5 output tokens each is 1000.
      expect(bucket?.equivalentOutputTokens).toBe(1100);
      expect(bucket?.costUsd).toBeNull();
    });

    it("charges an OpenAI long-context turn its premium", () => {
      const record = {
        t: daysAgo(3),
        k: "tokens" as const,
        m: "gpt-5.6-sol",
        d: "gpt-5.6-sol",
        v: "codex",
        i: 300_000,
        o: 1000,
      };
      const standard = summarizeUsage([record], { now }).users[0]?.total
        .byModel[0];
      const long = summarizeUsage([{ ...record, x: 1 as const }], { now })
        .users[0]?.total.byModel[0];
      // Prompt doubles and output is half again, so the premium lands above the
      // standard charge but below twice it.
      expect(long?.costUsd ?? 0).toBeGreaterThan(standard?.costUsd ?? 0);
      expect(long?.costUsd ?? 0).toBeLessThan(2 * (standard?.costUsd ?? 0));
    });

    it("charges a long Claude turn nothing extra, its 1M window being flat", () => {
      const record = {
        t: daysAgo(3),
        k: "tokens" as const,
        m: "fable[1m]",
        d: "claude-fable-5",
        v: "claude",
        i: 300_000,
        o: 1000,
      };
      const standard = summarizeUsage([record], { now }).users[0]?.total
        .byModel[0];
      // A long-context flag on a provider with no tier changes nothing, so a
      // stale record written under the old premium still prices correctly.
      const flagged = summarizeUsage([{ ...record, x: 1 as const }], { now })
        .users[0]?.total.byModel[0];
      expect(flagged?.costUsd).toBe(standard?.costUsd);
    });

    it("is nobody's action, so it moves no count and no interaction time", () => {
      const archer = archerOf(tokenEvents);
      // One turn, so one five-minute stretch — the token records neither add
      // turns nor extend presence.
      expect(archer?.total).toMatchObject({
        turns: 1,
        sessions: 0,
        activeMs: USAGE_AFK_AFTER_MS,
      });
      expect(archer?.lastWeek.activeMs).toBe(0);
    });

    it("collects a charge with no model named in the empty bucket", () => {
      const report = summarizeUsage([{ t: daysAgo(1), k: "tokens", o: 7 }], {
        now,
      });
      expect(report.users[0]?.total.byModel.map((b) => b.name)).toEqual([""]);
    });
  });
});

describe("coveredCalendarDays", () => {
  const day = (iso: string) => new Date(iso).getTime();

  it("is zero with nothing recorded", () => {
    expect(coveredCalendarDays(null, day("2026-09-21T12:00:00"))).toBe(0);
  });

  it("counts one day when the ledger starts today", () => {
    expect(
      coveredCalendarDays(
        day("2026-09-21T01:00:00"),
        day("2026-09-21T23:00:00"),
      ),
    ).toBe(1);
  });

  it("counts both ends, so an overnight ledger covers two days", () => {
    expect(
      coveredCalendarDays(
        day("2026-09-20T23:30:00"),
        day("2026-09-21T00:30:00"),
      ),
    ).toBe(2);
  });

  it("counts calendar dates rather than elapsed 24-hour spans", () => {
    expect(
      coveredCalendarDays(
        day("2026-09-01T09:00:00"),
        day("2026-09-21T09:00:00"),
      ),
    ).toBe(21);
  });
});
