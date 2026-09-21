import { describe, expect, it } from "vitest";
import {
  USAGE_AFK_AFTER_MS,
  countWords,
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
});
