import {
  registerProcess,
  readRegisteredProcess,
  unregisterProcess,
} from "./process-registry.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedDefaultProfile } from "./default-profile.js";
import { getE2EProfileDirectory, getE2ERunDirectory } from "./run-directory.js";
import {
  startYaServerProcess,
  disposeYaServerProcess,
  type YaServerProcess,
} from "./ya-server-process.js";
import { terminateChildProcess } from "./process-lifecycle.js";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const tsxLoader = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

function profileDirectory(): string {
  const directory = getE2EProfileDirectory();
  if (!directory) throw new Error("E2E run directory unavailable");
  mkdirSync(directory, { recursive: true });
  return directory;
}

async function readStartupJson<T>(url: string, deadline: number): Promise<T> {
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(2_000, deadline - Date.now())),
        ),
      });
      if (!response.ok)
        throw new Error(`${url} readiness failed: ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      if (
        !(error instanceof TypeError) &&
        !(
          error instanceof DOMException &&
          ["TimeoutError", "AbortError"].includes(error.name)
        )
      )
        throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${url} missed the startup deadline`, { cause: lastError });
}

export async function startWorkerServer(): Promise<YaServerProcess> {
  const started = performance.now();
  const deadline = Date.now() + 45_000;
  const paths = await seedDefaultProfile(profileDirectory());
  const server = await startYaServerProcess({
    label: `worker ${process.env.TEST_WORKER_INDEX} server`,
    profilePaths: { ...paths, profileDir: paths.testDir },
    startupDeadline: deadline,
    env: {
      SERVE_FRONTEND: "true",
      CLIENT_DIST_PATH: join(getE2ERunDirectory()!, "client-dist"),
      MAINTENANCE_PORT: "-1",
      MAINTENANCE_PORT_FILE: paths.maintenancePortFile,
      LOG_LEVEL: process.env.E2E_SERVER_LOG_LEVEL ?? "warn",
      LOG_FILE_LEVEL: process.env.E2E_SERVER_FILE_LOG_LEVEL ?? "warn",
    },
  });
  try {
    // /health means the listener is bound. Watchers attach later by design;
    // mutating a transcript before attachment can become an unannounced part
    // of their initial baseline. Wait on fixed-cost maintenance diagnostics.
    let maintenancePort = 0;
    while (maintenancePort <= 0) {
      if (existsSync(paths.maintenancePortFile))
        maintenancePort =
          Number.parseInt(
            readFileSync(paths.maintenancePortFile, "utf-8"),
            10,
          ) || 0;
      if (Date.now() >= deadline)
        throw new Error(
          "Worker maintenance listener missed the startup deadline",
        );
      if (maintenancePort <= 0)
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    while (true) {
      const status = await readStartupJson<{
        diagnostics: {
          background: {
            providerSessionWatchers: {
              families: Array<{
                family: string;
                watching: boolean;
                baselineState: string;
                error: string | null;
              }>;
            };
          };
        };
      }>(`http://127.0.0.1:${maintenancePort}/status`, deadline);
      const watchers = status.diagnostics.background.providerSessionWatchers;
      const families = ["claude", "codex", "gemini"].map((family) =>
        watchers.families.find((entry) => entry.family === family),
      );
      if (
        families.some(
          (entry) => entry?.error || entry?.baselineState === "failed",
        )
      ) {
        throw new Error(
          `Worker provider watcher failed: ${JSON.stringify(families)}`,
        );
      }
      if (
        families.every(
          (entry) => entry?.watching && entry.baselineState === "complete",
        )
      )
        break;
      if (Date.now() >= deadline)
        throw new Error("Worker provider watchers missed the startup deadline");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    while (true) {
      const data = await readStartupJson<{
        sessions: Array<{ id: string }>;
        catalog: { complete: boolean; refreshing: boolean };
      }>(
        `${server.baseUrl}/api/sessions?summaryMode=retained&limit=500&includeArchived=true`,
        deadline,
      );
      if (
        data.catalog.complete &&
        !data.catalog.refreshing &&
        data.sessions.some((session) => session.id === "mock-session-001")
      )
        break;
      if (Date.now() >= deadline)
        throw new Error("Worker seeded catalog missed the startup deadline");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    try {
      await disposeYaServerProcess(server);
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Worker readiness and cleanup failed",
      );
    }
    throw error;
  }
  console.log(
    `[E2E] Worker ${process.env.TEST_WORKER_INDEX} server ready in ${Math.round(performance.now() - started)}ms`,
  );
  return server;
}

export interface WorkerRelay {
  process: ChildProcess;
  port: number;
  registryFile?: string;
}

export async function startWorkerRelay(): Promise<WorkerRelay> {
  const directory = profileDirectory();
  const portFile = join(directory, "relay-port");
  const child = spawn(
    process.execPath,
    ["--import", tsxLoader, "--conditions", "source", "src/index.ts"],
    {
      cwd: join(repoRoot, "packages", "relay"),
      env: {
        ...process.env,
        RELAY_PORT: "0",
        RELAY_PORT_FILE: portFile,
        RELAY_DATA_DIR: join(directory, "relay"),
        RELAY_ALLOWED_ORIGINS: "*",
        RELAY_LOG_LEVEL: "warn",
        RELAY_LOG_TO_FILE: "false",
        RELAY_WEBSOCKET_MAX_MESSAGE_BYTES: String(1024 * 1024),
        RELAY_MUX_OPEN_ATTEMPTS_PER_MINUTE_PER_IP_USERNAME: "20",
      },
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let failure: Error | undefined;
  child.on("error", (error) => {
    failure = error;
  });
  const capture = (data: Buffer) => {
    output = `${output}${data}`.slice(-16_384);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  let registryFile: string | undefined;
  const started = Date.now();
  try {
    if (child.pid) {
      writeFileSync(join(directory, "relay-pid"), String(child.pid));
      registryFile = await registerProcess({
        pid: child.pid,
        label: "worker relay",
      });
    }
    while (Date.now() - started < 30_000) {
      if (failure || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Worker relay exited during startup: ${failure?.message ?? child.exitCode}\n${output}`,
        );
      }
      if (existsSync(portFile)) {
        const port = Number.parseInt(readFileSync(portFile, "utf-8"), 10);
        if (port > 0) return { process: child, port, registryFile };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Worker relay startup timed out\n${output}`);
  } catch (error) {
    try {
      await terminateChildProcess(
        child,
        "worker relay",
        readRegisteredProcess(registryFile)?.leaderStartTime,
      );
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Worker relay startup and cleanup failed",
      );
    }
    unregisterProcess(registryFile);
    throw error;
  }
}
