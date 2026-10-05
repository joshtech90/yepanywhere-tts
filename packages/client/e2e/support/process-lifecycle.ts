import { execFile, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ProcessIdentityApi {
  readProcessStartTime(pid: number): string | null;
  processGroupAlive(pid: number): boolean;
  processGroupIdentityState(target: {
    processGroupId: number;
    leaderStartTime: string;
  }): "same" | "different" | "absent";
}
const identityUrl = pathToFileURL(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "scripts",
    "provider-process-identity.mjs",
  ),
).href;
let identities: Promise<ProcessIdentityApi> | undefined;
function identityApi(): Promise<ProcessIdentityApi> {
  identities ??= import(identityUrl) as Promise<ProcessIdentityApi>;
  return identities;
}

export async function captureLeaderStartTime(
  pid: number,
): Promise<string | undefined> {
  // Windows uses taskkill's tree operation; the native identity helper supports
  // Unix process groups. Child handles remain the primary Windows owner.
  if (process.platform === "win32") return undefined;
  return (await identityApi()).readProcessStartTime(pid) ?? undefined;
}

export async function signalProcessTree(
  pid: number,
  force = false,
): Promise<void> {
  if (process.platform === "win32") {
    // Drain launcher pipes and deliver child exit events while taskkill runs.
    // Preserve its output so a real cleanup failure remains diagnosable.
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 10_000,
    });
  } else {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  }
}

/** Reclaim a complete owned group, including descendants of a dead leader. */
export async function terminateRegisteredProcess(
  pid: number,
  label: string,
  leaderStartTime?: string,
): Promise<void> {
  const api = process.platform === "win32" ? undefined : await identityApi();
  const identity = leaderStartTime;
  if (api && !identity) {
    if (!api.processGroupAlive(pid)) return;
    throw new Error(
      `${label} has no recorded process identity; refusing recovery`,
    );
  }
  const alive = () => {
    if (api && identity) {
      const state = api.processGroupIdentityState({
        processGroupId: pid,
        leaderStartTime: identity,
      });
      if (state === "different")
        throw new Error(
          `${label} process group identity changed; refusing to signal it`,
        );
      return state === "same";
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  if (!alive()) return;
  try {
    await signalProcessTree(pid);
  } catch (error) {
    // taskkill can return nonzero when the target exits during its tree walk.
    // Accept that race only after the owned target is demonstrably absent.
    if (alive()) throw error;
  }
  const gracefulDeadline = Date.now() + 10_000;
  while (alive() && Date.now() < gracefulDeadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (!alive()) return;
  try {
    await signalProcessTree(pid, true);
  } catch (error) {
    if (alive()) throw error;
  }
  const forcedDeadline = Date.now() + 2_000;
  while (alive() && Date.now() < forcedDeadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (alive())
    throw new Error(
      `${label} (${pid}) remained alive after forced termination`,
    );
}

export async function terminateChildProcess(
  child: ChildProcess,
  label: string,
  leaderStartTime?: string,
): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (
    process.platform === "win32" &&
    (child.exitCode !== null || child.signalCode !== null)
  )
    return;
  // A still-running ChildProcess handle establishes ownership of this leader.
  // Coordinator recovery has no such handle and must never capture a later
  // occupant's identity in place of the originally recorded one.
  const identity =
    leaderStartTime ??
    (child.exitCode === null && child.signalCode === null
      ? await captureLeaderStartTime(pid)
      : undefined);
  await terminateRegisteredProcess(pid, label, identity);
}
