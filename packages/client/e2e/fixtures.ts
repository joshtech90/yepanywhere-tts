import {
  unregisterProcess,
  readRegisteredProcess,
} from "./support/process-registry.js";
import { drainManagedRoutes } from "./support/managed-routes.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base } from "@playwright/test";

import {
  getE2EProfileDirectory,
  getE2ERunDirectory,
  usesWorkerServers,
} from "./support/run-directory.js";
import { defaultProfilePaths } from "./support/profile-paths.js";
import {
  startWorkerRelay,
  startWorkerServer,
  type WorkerRelay,
} from "./support/worker-services.js";
import {
  disposeYaServerProcess,
  type YaServerProcess,
} from "./support/ya-server-process.js";
import { terminateChildProcess } from "./support/process-lifecycle.js";

function getTempDir(): string {
  const tempDir = getE2EProfileDirectory();
  if (tempDir) return tempDir;
  throw new Error("Run directory unavailable. Did global-setup run?");
}

/**
 * Read a port from a file in the temp directory.
 */
function getPort(
  filename: string,
  description: string,
  shared = false,
): number {
  const tempDir = shared ? getE2ERunDirectory()! : getTempDir();
  const portFile = join(tempDir, filename);
  if (existsSync(portFile)) {
    return Number.parseInt(readFileSync(portFile, "utf-8"), 10);
  }
  throw new Error(
    `${description} port file not found: ${portFile}. Did global-setup run?`,
  );
}

function getServerPort(): number {
  return getPort("port", "Server");
}

function getMaintenancePort(): number {
  return getPort("maintenance-port", "Maintenance");
}

function getRemoteClientPort(): number {
  return getPort("remote-port", "Remote client", true);
}

export function getRemotePreviewPort(): number {
  return getPort("remote-preview-port", "Remote preview", true);
}

function getRelayPort(): number {
  if (
    ["0", "false", "no"].includes(
      (process.env.YEP_E2E_START_RELAY ?? "").toLowerCase(),
    )
  ) {
    throw new Error(
      "Relay fixtures requested, but relay startup is disabled via YEP_E2E_START_RELAY.",
    );
  }
  return getPort("relay-port", "Relay");
}

interface E2EPaths {
  tempDir: string;
  testDir: string;
  claudeSessionsDir: string;
  codexSessionsDir: string;
  geminiSessionsDir: string;
  dataDir: string;
}

function getTestPaths(): E2EPaths {
  return defaultProfilePaths(getTempDir());
}

// Export paths for tests to use instead of hardcoded homedir() paths
export const e2ePaths = {
  get clientDist() {
    return join(getE2ERunDirectory()!, "client-dist");
  },
  get tempDir() {
    return getTestPaths().tempDir;
  },
  get testDir() {
    return getTestPaths().testDir;
  },
  get claudeSessionsDir() {
    return getTestPaths().claudeSessionsDir;
  },
  get codexSessionsDir() {
    return getTestPaths().codexSessionsDir;
  },
  get geminiSessionsDir() {
    return getTestPaths().geminiSessionsDir;
  },
  get dataDir() {
    return getTestPaths().dataDir;
  },
};

export async function setLiveWorktreeMonitoring(
  baseURL: string,
  enabled: boolean,
): Promise<void> {
  const response = await fetch(`${baseURL}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Yep-Anywhere": "true",
    },
    body: JSON.stringify({ liveWorktreeMonitoringEnabled: enabled }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to ${enabled ? "enable" : "disable"} live worktree monitoring: ${await response.text()}`,
    );
  }
}

/**
 * Helper to configure remote access for tests.
 * Uses the REST API to set up relay config and SRP credentials.
 * Relay username is used as the SRP identity.
 */
export interface RemoteAccessConfig {
  /** Username for relay and SRP identity */
  username: string;
  /** Password for SRP authentication */
  password: string;
  /** Optional relay URL (defaults to wss://relay.yepanywhere.com/ws) */
  relayUrl?: string;
}

export async function configureRemoteAccess(
  baseURL: string,
  config: RemoteAccessConfig,
): Promise<void> {
  // First configure relay (username is used as SRP identity)
  const relayResponse = await fetch(`${baseURL}/api/remote-access/relay`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Yep-Anywhere": "true",
    },
    body: JSON.stringify({
      url: config.relayUrl ?? "wss://relay.yepanywhere.com/ws",
      username: config.username,
    }),
  });
  if (!relayResponse.ok) {
    const error = await relayResponse.text();
    throw new Error(`Failed to configure relay: ${error}`);
  }

  // Then configure password
  const configResponse = await fetch(`${baseURL}/api/remote-access/configure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Yep-Anywhere": "true",
    },
    body: JSON.stringify({ password: config.password }),
  });
  if (!configResponse.ok) {
    const error = await configResponse.text();
    throw new Error(`Failed to configure remote access: ${error}`);
  }
}

export async function disableRemoteAccess(baseURL: string): Promise<void> {
  const response = await fetch(`${baseURL}/api/remote-access/clear`, {
    method: "POST",
    headers: {
      "X-Yep-Anywhere": "true", // Required by security middleware
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to disable remote access: ${error}`);
  }
}

/**
 * Helper to configure relay connection for tests.
 * Uses the REST API to set up relay URL and username.
 */
export interface RelayConfig {
  url: string;
  username: string;
}

export async function configureRelay(
  baseURL: string,
  config: RelayConfig,
): Promise<void> {
  const response = await fetch(`${baseURL}/api/remote-access/relay`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Yep-Anywhere": "true", // Required by security middleware
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to configure relay: ${error}`);
  }
}

export async function disableRelay(baseURL: string): Promise<void> {
  const response = await fetch(`${baseURL}/api/remote-access/relay`, {
    method: "DELETE",
    headers: {
      "X-Yep-Anywhere": "true", // Required by security middleware
    },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to disable relay: ${error}`);
  }
}

/**
 * Wait for relay client to reach a specific status.
 */
export async function waitForRelayStatus(
  baseURL: string,
  targetStatus: string,
  timeoutMs = 10000,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const response = await fetch(`${baseURL}/api/remote-access/relay/status`, {
      headers: {
        "X-Yep-Anywhere": "true",
      },
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === targetStatus) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Relay did not reach status "${targetStatus}" within ${timeoutMs}ms`,
  );
}

// Extended test fixtures
interface TestFixtures {
  draftSessionIds: string[];
  resetSeededDrafts: undefined;
  baseURL: string;
  maintenanceURL: string;
  wsURL: string;
  remoteClientURL: string;
  remotePreviewURL: string;
  relayPort: number;
  relayWsURL: string;
}

interface WorkerFixtures {
  workerServer: YaServerProcess | undefined;
  workerRelay: WorkerRelay | undefined;
}

// Extend base test with dynamic baseURL and maintenanceURL
export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerServer: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
    async ({}, use) => {
      const server = usesWorkerServers()
        ? await startWorkerServer()
        : undefined;
      try {
        await use(server);
      } finally {
        await disposeYaServerProcess(server ?? null);
      }
    },
    { scope: "worker", timeout: 60_000 },
  ],
  workerRelay: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
    async ({}, use) => {
      // Keep the existing opt-out behavior even when services start lazily.
      if (
        ["0", "false", "no"].includes(
          (process.env.YEP_E2E_START_RELAY ?? "").toLowerCase(),
        )
      ) {
        throw new Error(
          "Relay fixture requested while YEP_E2E_START_RELAY is disabled",
        );
      }
      const relay = usesWorkerServers() ? await startWorkerRelay() : undefined;
      try {
        await use(relay);
      } finally {
        if (relay) {
          await terminateChildProcess(
            relay.process,
            "worker relay",
            readRegisteredProcess(relay.registryFile)?.leaderStartTime,
          );
          unregisterProcess(relay.registryFile);
        }
      }
    },
    { scope: "worker", timeout: 45_000 },
  ],
  draftSessionIds: [["mock-session-001"], { option: true }],
  resetSeededDrafts: [
    async ({ baseURL, draftSessionIds }, use) => {
      // The shared server survives between cases, while browser contexts start
      // empty. Clear the seeded session's synced draft before another case uses it.
      const serverURL = baseURL;
      const headers = {
        "Content-Type": "application/json",
        "X-Yep-Anywhere": "true",
      };
      for (const sessionId of draftSessionIds) {
        const slot = { kind: "session", sessionId };
        const read = await fetch(`${serverURL}/api/drafts/read`, {
          method: "POST",
          headers,
          body: JSON.stringify({ slot }),
        });
        // The optional SQLite route or the seeded session catalog can be absent
        // on a supported local runtime; then the client cannot load this draft.
        if (read.status !== 404) {
          if (!read.ok)
            throw new Error(
              `Draft fixture read failed: ${read.status} ${await read.text()}`,
            );
          const { snapshot, ticket } = (await read.json()) as {
            snapshot: {
              revision: string | null;
              payload: {
                fields: Record<string, string>;
                attachments: unknown[];
              };
            };
            ticket: string;
          };
          if (
            snapshot.revision !== null &&
            (Object.values(snapshot.payload.fields).some((value) =>
              value.trim(),
            ) ||
              snapshot.payload.attachments.length > 0)
          ) {
            const clear = await fetch(`${serverURL}/api/drafts/clear`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                slot,
                baseRevision: snapshot.revision,
                ticket,
                operationId: randomUUID(),
              }),
            });
            if (!clear.ok)
              throw new Error(`Draft fixture clear failed: ${clear.status}`);
            const result = (await clear.json()) as { outcome: string };
            if (result.outcome !== "accepted")
              throw new Error(`Draft fixture clear was ${result.outcome}`);
          }
        }
      }
      await use(undefined);
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    await use(page);
    // A completed assertion does not imply intercepted background requests
    // have finished. Drain handlers before the base context fixture closes.
    // Some tests own an earlier page close before stopping their dev server.
    if (!page.isClosed()) {
      try {
        await drainManagedRoutes(page);
      } finally {
        await page.unrouteAll({ behavior: "wait" });
      }
    }
  },
  baseURL: async ({ workerServer }, use) => {
    const port = workerServer?.port ?? getServerPort();
    await use(`http://localhost:${port}`);
  },
  maintenanceURL: async ({ workerServer }, use) => {
    void workerServer;
    const port = getMaintenancePort();
    await use(`http://localhost:${port}`);
  },
  wsURL: async ({ workerServer }, use) => {
    const port = workerServer?.port ?? getServerPort();
    await use(`ws://localhost:${port}/api/ws`);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern requires empty destructure
  remoteClientURL: async ({}, use) => {
    const port = getRemoteClientPort();
    await use(`http://localhost:${port}`);
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture pattern requires empty destructure
  remotePreviewURL: async ({}, use) => {
    const port = getRemotePreviewPort();
    await use(`http://localhost:${port}`);
  },
  relayPort: async ({ workerRelay }, use) => {
    const port = workerRelay?.port ?? getRelayPort();
    await use(port);
  },
  relayWsURL: async ({ workerRelay }, use) => {
    const port = workerRelay?.port ?? getRelayPort();
    await use(`ws://localhost:${port}/ws`);
  },
});

export { expect } from "@playwright/test";
