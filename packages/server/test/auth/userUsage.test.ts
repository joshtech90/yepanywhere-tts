import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { USAGE_AFK_AFTER_MS } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_LEDGER_EVENTS,
  TRIM_SLACK,
  UserUsageService,
} from "../../src/auth/UserUsageService.js";

/** Contract: topics/limited-users.md § Delivery v1 — Usage. */

describe("UserUsageService", () => {
  let dir: string;
  let clock: number;
  let service: UserUsageService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ya-usage-"));
    clock = 1_000_000;
    service = new UserUsageService({ dataDir: dir, now: () => clock });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports nothing before anything happens", async () => {
    const report = await service.report();
    expect(report.since).toBeNull();
    expect(report.users).toEqual([expect.objectContaining({ username: null })]);
  });

  it("attributes an absent username to the superuser", async () => {
    await service.recordSession(undefined);
    await service.recordTurn(undefined, "two words");

    const report = await service.report();
    const superuser = report.users.find((user) => user.username === null);
    expect(superuser?.total).toMatchObject({
      sessions: 1,
      turns: 1,
      words: 2,
      activeMs: USAGE_AFK_AFTER_MS,
    });
  });

  it("keeps each principal's work apart", async () => {
    await service.recordSession("archer");
    await service.recordTurn("archer", "one two three");
    await service.recordTurn(undefined, "solo");

    const report = await service.report(["archer", "lana"]);
    expect(
      report.users.find((user) => user.username === "archer")?.total,
    ).toMatchObject({ sessions: 1, turns: 1, words: 3 });
    expect(
      report.users.find((user) => user.username === null)?.total,
    ).toMatchObject({ sessions: 0, turns: 1, words: 1 });
    // A user who has done nothing still appears, so the table shows them.
    expect(
      report.users.find((user) => user.username === "lana")?.total,
    ).toMatchObject({ sessions: 0, turns: 0, words: 0 });
  });

  it("survives a torn line from an interrupted append", async () => {
    await service.recordTurn("archer", "counted");
    const file = path.join(dir, "user-usage.jsonl");
    await fs.appendFile(file, '{"t":123,"k":"tu');

    const report = await service.report();
    expect(
      report.users.find((user) => user.username === "archer")?.total.turns,
    ).toBe(1);
  });

  it("forgets a deleted user without touching anyone else", async () => {
    await service.recordTurn("archer", "gone soon");
    await service.recordTurn(undefined, "kept");

    await service.forgetUser("archer");

    const report = await service.report();
    expect(report.users.find((user) => user.username === "archer")).toBe(
      undefined,
    );
    expect(
      report.users.find((user) => user.username === null)?.total.turns,
    ).toBe(1);
  });

  it("records a token charge against the model and project that caused it", async () => {
    await service.recordTurn("archer", "do the thing");
    await service.recordTokens({
      username: "archer",
      model: "opus",
      modelId: "claude-opus-4-5",
      provider: "claude",
      project: "yepanywhere",
      freshInputTokens: 1000,
      cachedInputTokens: 9000,
      cacheWriteTokens: 500,
      outputTokens: 2000,
    });

    const report = await service.report();
    const archer = report.users.find((user) => user.username === "archer");
    expect(archer?.total.turns).toBe(1);
    expect(archer?.total.tokens).toEqual({
      freshInputTokens: 1000,
      cachedInputTokens: 9000,
      cacheWriteTokens: 500,
      outputTokens: 2000,
    });
    // Named by the served model, not the "opus" alias it was launched as.
    expect(archer?.total.byModel).toEqual([
      expect.objectContaining({
        name: "claude-opus-4-5",
        equivalentOutputTokens: 2505,
      }),
    ]);
    expect(archer?.total.byProject).toEqual([
      expect.objectContaining({ name: "yepanywhere" }),
    ]);
  });

  it("appends nothing for a zero charge", async () => {
    await service.recordTokens({
      freshInputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
    const report = await service.report();
    expect(report.since).toBeNull();
  });

  it("takes a deleted user's token charges with them", async () => {
    await service.recordTokens({
      username: "archer",
      model: "opus",
      modelId: "claude-opus-4-5",
      provider: "claude",
      freshInputTokens: 500,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
    });
    await service.recordTokens({
      model: "opus",
      modelId: "claude-opus-4-5",
      provider: "claude",
      freshInputTokens: 7,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
    });

    await service.forgetUser("archer");

    const report = await service.report();
    expect(report.users.find((user) => user.username === "archer")).toBe(
      undefined,
    );
    expect(
      report.users.find((user) => user.username === null)?.total.tokens
        .freshInputTokens,
    ).toBe(7);
  });

  it("keeps the two context tiers as separate records", async () => {
    const charge = {
      model: "gpt-5.6-sol",
      modelId: "gpt-5.6-sol",
      provider: "codex" as const,
      freshInputTokens: 300_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1000,
    };
    await service.recordTokens(charge);
    await service.recordTokens({ ...charge, longContext: true });

    const raw = await fs.readFile(path.join(dir, "user-usage.jsonl"), "utf-8");
    const tiers = raw
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line).x);
    expect(tiers).toEqual([undefined, 1]);
  });

  it("keeps recording after one append fails", async () => {
    const file = path.join(dir, "user-usage.jsonl");
    // A directory where the ledger belongs makes the next append fail.
    await fs.mkdir(file);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        service.recordTurn("archer", "lost"),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        "[UserUsage] Usage ledger append failed:",
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
    await fs.rmdir(file);

    await service.recordTurn("archer", "counted");
    // Deleting a user does not answer with the earlier append's failure.
    await expect(service.forgetUser("lana")).resolves.toBeUndefined();

    const report = await service.report();
    expect(
      report.users.find((user) => user.username === "archer")?.total.turns,
    ).toBe(1);
  });

  it("trims a ledger an earlier process left over the cap", async () => {
    const file = path.join(dir, "user-usage.jsonl");
    const oversized = MAX_LEDGER_EVENTS + TRIM_SLACK;
    await fs.writeFile(
      file,
      Array.from(
        { length: oversized },
        (_, index) => `${JSON.stringify({ t: index, k: "turn" })}\n`,
      ).join(""),
    );
    // A process restarted before its own appends reach the cap must still
    // hold the file to it.
    const restarted = new UserUsageService({ dataDir: dir, now: () => clock });

    await restarted.recordTurn("archer", "newest");

    const lines = (await fs.readFile(file, "utf-8"))
      .split("\n")
      .filter((line) => line !== "");
    expect(lines).toHaveLength(MAX_LEDGER_EVENTS);
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({ u: "archer" });
  });

  it("reads back what an earlier process wrote", async () => {
    await service.recordTurn("archer", "before restart");
    const reopened = new UserUsageService({ dataDir: dir, now: () => clock });

    const report = await reopened.report();
    expect(
      report.users.find((user) => user.username === "archer")?.total.words,
    ).toBe(2);
  });
});
