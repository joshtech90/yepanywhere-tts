import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createE2ERunDirectory,
  getE2EProfileDirectory,
} from "../../../client/e2e/support/run-directory.js";
import { defaultProfilePaths } from "../../../client/e2e/support/profile-paths.js";
import {
  registerProcess,
  unregisterProcess,
} from "../../../client/e2e/support/process-registry.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function runRoot(): string {
  // Record the original value before createE2ERunDirectory sets it.
  vi.stubEnv("YEP_E2E_RUN_DIR", "");
  const root = createE2ERunDirectory();
  roots.push(root);
  return root;
}

describe("E2E worker ownership", () => {
  it("defaults to isolated paths before seeding and gives retry workers fresh profiles", () => {
    const root = runRoot();
    vi.stubEnv("YEP_E2E_SERVER_SCOPE", undefined);
    vi.stubEnv("TEST_WORKER_INDEX", undefined);
    expect(getE2EProfileDirectory()).toBe(root);
    vi.stubEnv("TEST_PARALLEL_INDEX", "0");
    vi.stubEnv("TEST_WORKER_INDEX", "0");
    const first = defaultProfilePaths(getE2EProfileDirectory()!);
    expect(existsSync(first.tempDir)).toBe(false);
    vi.stubEnv("TEST_WORKER_INDEX", "1");
    const peer = defaultProfilePaths(getE2EProfileDirectory()!);
    vi.stubEnv("TEST_WORKER_INDEX", "2");
    const retry = defaultProfilePaths(getE2EProfileDirectory()!);
    for (const key of [
      "tempDir",
      "claudeSessionsDir",
      "dataDir",
      "portFile",
      "relayPortFile",
    ] as const) {
      expect(new Set([first[key], peer[key], retry[key]]).size).toBe(3);
    }
  });

  it("keeps separate invocations disjoint and run scope available", () => {
    const first = runRoot();
    const second = runRoot();
    expect(first).not.toBe(second);
    vi.stubEnv("YEP_E2E_SERVER_SCOPE", "run");
    vi.stubEnv("TEST_WORKER_INDEX", "7");
    expect(getE2EProfileDirectory()).toBe(second);
  });

  it("leaves owned process records for coordinator recovery until disposal", async () => {
    runRoot();
    const owned = {
      pid: process.pid,
      label: "worker fixture",
      runtimeDir: "fixture-runtime",
    };
    const file = (await registerProcess(owned))!;
    expect(JSON.parse(readFileSync(file, "utf-8"))).toMatchObject(owned);
    await registerProcess({ ...owned, label: "restarted fixture" }, file);
    expect(JSON.parse(readFileSync(file, "utf-8")).label).toBe(
      "restarted fixture",
    );
    unregisterProcess(file);
    expect(existsSync(file)).toBe(false);
  });
});
