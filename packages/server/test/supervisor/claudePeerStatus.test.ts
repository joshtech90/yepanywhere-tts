import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudePeerStatus } from "../../src/supervisor/claudePeerStatus.js";

const START = "Thu Oct  1 06:40:59 2026";

describe("ClaudePeerStatus", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function peers(files: Record<string, unknown>): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "claude-peers-"));
    for (const [name, value] of Object.entries(files)) {
      await writeFile(
        join(dir, name),
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
    return dir;
  }

  const peer = (pid: number, sessionId: string, status: string) => ({
    pid,
    sessionId,
    status,
    procStart: START,
    pidDomain: process.platform,
  });

  it("reports busy only for a live, identical process of that session", async () => {
    const status = new ClaudePeerStatus(
      await peers({
        "101.json": peer(101, "busy", "busy"),
        "102.json": peer(102, "idle", "idle"),
        "103.json": peer(103, "dead", "busy"),
        "104.json": peer(104, "reused", "busy"),
        "105.json": { ...peer(105, "no-start", "busy"), procStart: undefined },
        "106.json": peer(999, "wrong-name", "busy"),
        "107.json": "{ half written",
        "notes.txt": "ignored",
      }),
      {
        isAlive: (pid) => pid !== 103,
        // 104 is alive, but a different process now holds that pid.
        startOf: async (pid) =>
          pid === 104 ? "Thu Oct  1 09:00:00 2026" : `${START}  `,
      },
    );
    expect(await status.isBusy("busy")).toBe(true);
    expect(await status.isBusy("idle")).toBe(false);
    expect(await status.isBusy("dead")).toBe(false);
    expect(await status.isBusy("reused")).toBe(false);
    expect(await status.isBusy("no-start")).toBe(false);
    expect(await status.isBusy("wrong-name")).toBe(false);
    expect(await status.isBusy("unknown")).toBe(false);
  });

  it("counts any live busy process when several share a session", async () => {
    const status = new ClaudePeerStatus(
      await peers({
        "201.json": peer(201, "shared", "busy"),
        "202.json": peer(202, "shared", "busy"),
        "203.json": peer(203, "shared", "idle"),
      }),
      // 201 is a stale busy file; 202 is the live writer.
      { isAlive: (pid) => pid !== 201, startOf: async () => START },
    );
    expect(await status.isBusy("shared")).toBe(true);
  });

  it("treats a missing directory as nobody busy", async () => {
    const status = new ClaudePeerStatus(join(tmpdir(), "no-such-peer-dir-x"));
    expect(await status.isBusy("any")).toBe(false);
  });
});
