import type { ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { registerProcess } from "./process-registry.js";
import { terminateChildProcess } from "./process-lifecycle.js";
import { stopProviderHostRuntime } from "./provider-host-runtime.js";

/** Arm coordinator ownership, with live-child cleanup on registration failure. */
export async function registerSharedServiceProcess(
  child: ChildProcess,
  options: { label: string; pidFile: string; runtimeDir?: string },
): Promise<void> {
  // Attach before any asynchronous work, including the no-PID spawn-error path.
  child.on("error", () => {});
  try {
    if (!child.pid) throw new Error(`${options.label} did not acquire a PID`);
    writeFileSync(options.pidFile, String(child.pid));
    await registerProcess({
      pid: child.pid,
      label: options.label,
      runtimeDir: options.runtimeDir,
    });
  } catch (error) {
    const failures: unknown[] = [];
    try {
      await terminateChildProcess(child, options.label);
    } catch (cleanup) {
      failures.push(cleanup);
    }
    // Stop the launcher first so it cannot create another detached host while
    // recovery enumerates launch receipts. Still attempt both on failure.
    if (options.runtimeDir) {
      try {
        await stopProviderHostRuntime(options.runtimeDir);
      } catch (cleanup) {
        failures.push(cleanup);
      }
    }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        `${options.label} registration and cleanup failed`,
      );
    throw error;
  }
}
