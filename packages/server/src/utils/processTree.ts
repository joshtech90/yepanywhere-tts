import { type ChildProcess, execFile } from "node:child_process";
import { stripYaControlPlaneCredentials } from "../sdk/providers/env-filter.js";

/**
 * Process-tree termination for a command YA launched: the command plus the
 * processes it started (a build tool's compilers, a shell's pipeline).
 *
 * Spawn with {@link processTreeSpawnOptions} so the command leads its own
 * process group on POSIX; {@link signalProcessTree} then signals that group.
 * A process that started its own group or session has left the tree and is
 * not reached. Windows has no process groups: every signal becomes a forced
 * `taskkill /T` of the tree rooted at the command.
 */
export const processTreeSpawnOptions = {
  detached: process.platform !== "win32",
} as const;

const TASKKILL_TIMEOUT_MS = 1000;

/** Signal a command spawned with {@link processTreeSpawnOptions} and its descendants. */
export function signalProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    // taskkill walks the tree from a live root only.
    if (child.exitCode !== null || child.signalCode !== null) return;
    execFile(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      {
        timeout: TASKKILL_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 1024,
        windowsHide: true,
        env: stripYaControlPlaneCredentials(process.env),
      },
      () => {
        child.kill("SIGKILL");
      },
    );
    return;
  }
  try {
    // The group outlives its leader, so signal it even after the command exits.
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      child.kill(signal);
    }
  }
}
