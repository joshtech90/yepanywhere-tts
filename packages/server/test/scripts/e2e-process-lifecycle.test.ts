import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import {
  captureLeaderStartTime,
  signalProcessTree,
  terminateChildProcess,
  terminateRegisteredProcess,
} from "../../../client/e2e/support/process-lifecycle.js";

async function forceCleanup(pid: number): Promise<void> {
  try {
    await signalProcessTree(pid, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

describe("E2E detached process cleanup", () => {
  it.runIf(process.platform === "win32")(
    "reclaims a live Windows child tree and permits repeated cleanup",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
          const {spawn} = require('node:child_process');
          const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
          console.log(descendant.pid);
          setInterval(() => {}, 1000);
        `,
        ],
        { detached: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      try {
        const [data] = await once(child.stdout!, "data");
        const descendant = Number.parseInt(String(data), 10);
        await terminateChildProcess(child, "Windows regression tree");
        expect(() => process.kill(child.pid!, 0)).toThrow();
        expect(() => process.kill(descendant, 0)).toThrow();
        await terminateChildProcess(child, "already reclaimed tree");
      } finally {
        await terminateChildProcess(child, "Windows regression cleanup");
      }
    },
  );
  it.skipIf(process.platform === "win32")(
    "refuses coordinator recovery without the original identity or with a mismatch",
    async () => {
      const child = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        {
          detached: true,
          stdio: "ignore",
        },
      );
      const identity = await captureLeaderStartTime(child.pid!);
      try {
        await expect(
          terminateRegisteredProcess(child.pid!, "missing identity"),
        ).rejects.toThrow("no recorded process identity");
        expect(() => process.kill(child.pid!, 0)).not.toThrow();
        await expect(
          terminateRegisteredProcess(
            child.pid!,
            "wrong identity",
            "not-the-original-start",
          ),
        ).rejects.toThrow("identity changed");
        expect(() => process.kill(child.pid!, 0)).not.toThrow();
      } finally {
        await terminateChildProcess(child, "owned regression child", identity);
      }
    },
  );
  it.skipIf(process.platform === "win32")(
    "reclaims a descendant after its group leader has exited",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
      const {spawn} = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
      console.log(descendant.pid);
      setInterval(() => {}, 1000);
    `,
        ],
        { detached: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      try {
        const [data] = await once(child.stdout!, "data");
        const descendant = Number.parseInt(String(data), 10);
        const identity = await captureLeaderStartTime(child.pid!);
        expect(identity).toBeTruthy();
        const exited = once(child, "exit");
        process.kill(child.pid!, "SIGTERM");
        await exited;
        expect(() => process.kill(descendant, 0)).not.toThrow();
        await terminateChildProcess(child, "dead-leader regression", identity);
        expect(() => process.kill(descendant, 0)).toThrow();
      } finally {
        await forceCleanup(child.pid!);
      }
    },
  );
});
