import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stopProviderHostRuntime } from "./support/provider-host-runtime.js";
import { presentUiCaptures } from "./support/ui-capture.js";

import { getE2ERunDirectory } from "./support/run-directory.js";

export default async function globalTeardown() {
  // Hand any recorded screenshots to the shared presentation helper before the
  // run directory goes away, so the maintainer sees the images beside the call.
  await presentUiCaptures();
  const keepTemp =
    process.env.E2E_KEEP_TEMP === "1" ||
    process.env.E2E_KEEP_TEMP === "true" ||
    process.env.E2E_KEEP_TEMP === "yes";

  const tempDir = getE2ERunDirectory();
  if (!tempDir) {
    console.log("[E2E] No run directory found, nothing to clean up");
    return;
  }

  console.log(`[E2E] Cleaning up temp directory: ${tempDir}`);

  // Read paths from the temp directory
  const pathsFile = join(tempDir, "paths.json");
  let paths: {
    pidFile?: string;
    remoteClientPidFile?: string;
    remotePreviewPidFile?: string;
    relayPidFile?: string;
  } = {};

  if (existsSync(pathsFile)) {
    try {
      paths = JSON.parse(readFileSync(pathsFile, "utf-8"));
    } catch {
      // Ignore parse errors
    }
  }

  // Kill processes using PID files
  const pidFiles = [
    { file: paths.pidFile ?? join(tempDir, "pid"), name: "server" },
    {
      file: paths.remoteClientPidFile ?? join(tempDir, "remote-pid"),
      name: "remote client",
    },
    {
      file: paths.remotePreviewPidFile ?? join(tempDir, "remote-preview-pid"),
      name: "remote preview",
    },
    {
      file: paths.relayPidFile ?? join(tempDir, "relay-pid"),
      name: "relay server",
    },
  ];

  for (const { file, name } of pidFiles) {
    if (existsSync(file)) {
      const pid = Number.parseInt(readFileSync(file, "utf-8"), 10);
      try {
        // Kill the process group (negative PID kills the group)
        process.kill(-pid, "SIGTERM");
        console.log(`[E2E] Killed ${name} process group ${pid}`);
      } catch (err) {
        // Process may already be dead
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
          console.error(`[E2E] Error killing ${name}:`, err);
        }
      }
    }
  }

  // The provider host detached into its own process group, so the signals
  // above never reached it, and nothing else owns this run's runtime directory.
  await stopProviderHostRuntime(join(tempDir, "provider-host"));

  if (keepTemp) {
    console.log(`[E2E] Keeping temp directory for debugging: ${tempDir}`);
    return;
  }

  // Clean up the entire temp directory
  try {
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[E2E] Removed temp directory: ${tempDir}`);
  } catch (err) {
    console.error("[E2E] Error removing temp directory:", err);
  }

  delete process.env.YEP_E2E_RUN_DIR;
}
