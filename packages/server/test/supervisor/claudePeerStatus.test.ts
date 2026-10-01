import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudePeerStatus } from "../../src/supervisor/claudePeerStatus.js";

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

  it("reports busy only for a live process of that session", async () => {
    const status = new ClaudePeerStatus(
      await peers({
        "101.json": { pid: 101, sessionId: "busy", status: "busy" },
        "102.json": { pid: 102, sessionId: "idle", status: "idle" },
        "103.json": { pid: 103, sessionId: "dead", status: "busy" },
        "104.json": "{ half written",
        "notes.txt": "ignored",
      }),
      { isAlive: (pid) => pid !== 103 },
    );
    expect(await status.isBusy("busy")).toBe(true);
    expect(await status.isBusy("idle")).toBe(false);
    expect(await status.isBusy("dead")).toBe(false);
    expect(await status.isBusy("unknown")).toBe(false);
  });

  it("prefers a busy process when two share a session", async () => {
    const status = new ClaudePeerStatus(
      await peers({
        "201.json": { pid: 201, sessionId: "shared", status: "idle" },
        "202.json": { pid: 202, sessionId: "shared", status: "busy" },
      }),
      { isAlive: () => true },
    );
    expect(await status.isBusy("shared")).toBe(true);
  });

  it("treats a missing directory as nobody busy", async () => {
    const status = new ClaudePeerStatus(join(tmpdir(), "no-such-peer-dir-x"));
    expect(await status.isBusy("any")).toBe(false);
  });
});
