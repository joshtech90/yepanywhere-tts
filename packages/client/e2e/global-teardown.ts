import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  providerHostRuntimeDir,
  stopProviderHostRuntime,
} from "./support/provider-host-runtime.js";
import { presentUiCaptures } from "./support/ui-capture.js";

import { getE2ERunDirectory } from "./support/run-directory.js";
import { terminateRegisteredProcess } from "./support/process-lifecycle.js";
import type { OwnedProcess } from "./support/process-registry.js";

export default async function globalTeardown() {
  const failures: unknown[] = [];
  // Hand any recorded screenshots to the shared presentation helper before the
  // run directory goes away, so the maintainer sees the images beside the call.
  try {
    await presentUiCaptures();
  } catch (error) {
    failures.push(error);
  }
  const keepTemp =
    process.env.E2E_KEEP_TEMP === "1" ||
    process.env.E2E_KEEP_TEMP === "true" ||
    process.env.E2E_KEEP_TEMP === "yes";

  const tempDir = getE2ERunDirectory();
  if (!tempDir) {
    if (failures.length)
      throw new AggregateError(failures, "E2E presentation failed");
    console.log("[E2E] No run directory found, nothing to clean up");
    return;
  }

  console.log(`[E2E] Cleaning up temp directory: ${tempDir}`);

  const registry = join(tempDir, "processes");
  if (existsSync(registry)) {
    const results = await Promise.allSettled(
      readdirSync(registry)
        .filter((filename) => filename.endsWith(".json"))
        .map(async (filename) => {
          const owned = JSON.parse(
            readFileSync(join(registry, filename), "utf-8"),
          ) as OwnedProcess;
          const errors: unknown[] = [];
          try {
            await terminateRegisteredProcess(
              owned.pid,
              owned.label,
              owned.leaderStartTime,
            );
          } catch (error) {
            errors.push(error);
          }
          if (owned.runtimeDir) {
            try {
              await stopProviderHostRuntime(owned.runtimeDir);
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length)
            throw new AggregateError(
              errors,
              `Could not reclaim ${owned.label}`,
            );
        }),
    );
    for (const result of results)
      if (result.status === "rejected") failures.push(result.reason);
  }
  try {
    await stopProviderHostRuntime(providerHostRuntimeDir(tempDir));
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      `E2E cleanup failed; recovery state retained at ${tempDir}`,
    );
  }

  if (keepTemp) {
    console.log(`[E2E] Keeping temp directory for debugging: ${tempDir}`);
    return;
  }

  // Clean up the entire temp directory
  try {
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[E2E] Removed temp directory: ${tempDir}`);
  } catch (err) {
    throw new Error(`E2E could not remove its directory: ${tempDir}`, {
      cause: err,
    });
  }

  delete process.env.YEP_E2E_RUN_DIR;
}
