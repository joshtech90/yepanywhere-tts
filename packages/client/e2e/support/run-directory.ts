import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** globalSetup passes this invocation's directory to workers and teardown. */
export function createE2ERunDirectory(): string {
  const directory = mkdtempSync(
    join(process.platform === "darwin" ? "/tmp" : tmpdir(), "claude-e2e-"),
  );
  process.env.YEP_E2E_RUN_DIR = directory;
  return directory;
}

export function getE2ERunDirectory(): string | undefined {
  const directory = process.env.YEP_E2E_RUN_DIR;
  return directory && existsSync(directory) ? directory : undefined;
}

export function usesWorkerServers(): boolean {
  const scope = process.env.YEP_E2E_SERVER_SCOPE ?? "worker";
  if (scope !== "run" && scope !== "worker") {
    throw new Error(`Invalid YEP_E2E_SERVER_SCOPE: ${scope}`);
  }
  return scope === "worker";
}

/** Worker index changes on retry, so a replacement never inherits a profile. */
export function getE2EProfileDirectory(): string | undefined {
  const root = getE2ERunDirectory();
  const index = process.env.TEST_WORKER_INDEX;
  if (!root || !usesWorkerServers() || index === undefined) return root;
  if (!/^\d+$/.test(index))
    throw new Error(`Invalid TEST_WORKER_INDEX: ${index}`);
  return join(root, `w${index}`);
}
