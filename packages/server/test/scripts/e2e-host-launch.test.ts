import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { stopProviderHostRuntime } from "../../../client/e2e/support/provider-host-runtime.js";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const observer = join(
  repoRoot,
  "packages/client/e2e/support/record-host-launch.mjs",
);
const host = join(repoRoot, "scripts/provider-runtime-host.mjs");

beforeEach(() => {
  mkdirSync(process.env.YEP_DATA_DIR!, { recursive: true });
});

describe("E2E host launch ownership", () => {
  it("retains an incomplete launch instead of treating descriptor absence as cleanup", async () => {
    const root = mkdtempSync(join(process.env.YEP_DATA_DIR!, "pending-host-"));
    const directory = join(root, "e2e-launches");
    mkdirSync(directory);
    const receipt = join(directory, "pending.json");
    writeFileSync(receipt, JSON.stringify({ pending: true }));
    try {
      await expect(stopProviderHostRuntime(root)).rejects.toThrow(
        "Could not reclaim",
      );
      expect(existsSync(receipt)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "reclaims a detached real host after its launcher dies before publication",
    async () => {
      const root = mkdtempSync(
        join(process.env.YEP_DATA_DIR!, "pending-host-"),
      );
      const delay = join(root, "delay.mjs");
      writeFileSync(
        delay,
        "await new Promise(resolve => setTimeout(resolve, 60000));",
      );
      const launcher = spawn(
        process.execPath,
        [
          "--import",
          pathToFileURL(observer).href,
          "--input-type=module",
          "-e",
          `
          import { spawn } from 'node:child_process';
          const child = spawn(process.execPath, [${JSON.stringify(host)}, '--headless'], {
            detached: true,
            stdio: 'ignore',
            env: {
              ...process.env,
              YEP_PROVIDER_HOST_RUNTIME_DIR: ${JSON.stringify(root)},
              NODE_OPTIONS: '--import ' + ${JSON.stringify(pathToFileURL(delay).href)},
            },
          });
          child.unref();
          setInterval(() => {}, 1000);
        `,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      launcher.stderr?.on("data", (data) => {
        output = (output + data).slice(-4096);
      });
      let hostPid: number | undefined;
      try {
        await expect
          .poll(
            () => {
              if (launcher.exitCode !== null)
                throw new Error(`Host launcher exited: ${output}`);
              const directory = join(root, "e2e-launches");
              if (!existsSync(directory)) return false;
              for (const file of readdirSync(directory)) {
                if (!file.endsWith(".json")) continue;
                const receipt = JSON.parse(
                  readFileSync(join(directory, file), "utf8"),
                );
                if (receipt.pid && receipt.leaderStartTime) {
                  hostPid = receipt.pid;
                  return true;
                }
              }
              return false;
            },
            { timeout: 5000 },
          )
          .toBe(true);
        expect(existsSync(join(root, "host.json"))).toBe(false);
        expect(() => process.kill(hostPid!, 0)).not.toThrow();
        await killLauncher(launcher);
        await stopProviderHostRuntime(root);
        expect(() => process.kill(hostPid!, 0)).toThrow();
        expect(readdirSync(join(root, "e2e-launches"))).toEqual([]);
      } finally {
        await killLauncher(launcher);
        await stopProviderHostRuntime(root);
        rmSync(root, { recursive: true, force: true });
      }
    },
    15000,
  );
});

async function killLauncher(launcher: ChildProcess): Promise<void> {
  if (launcher.exitCode !== null || launcher.signalCode !== null) return;
  const exited = once(launcher, "exit");
  launcher.kill("SIGKILL");
  await exited;
}
