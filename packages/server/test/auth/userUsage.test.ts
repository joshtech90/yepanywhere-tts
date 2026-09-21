import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { USAGE_AFK_AFTER_MS } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserUsageService } from "../../src/auth/UserUsageService.js";

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

  it("reads back what an earlier process wrote", async () => {
    await service.recordTurn("archer", "before restart");
    const reopened = new UserUsageService({ dataDir: dir, now: () => clock });

    const report = await reopened.report();
    expect(
      report.users.find((user) => user.username === "archer")?.total.words,
    ).toBe(2);
  });
});
