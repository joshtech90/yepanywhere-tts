/**
 * Signal the process listening on a local TCP port.
 *
 * Killing by port is inherently dangerous, so every caller goes through these
 * guards: the listener must be unique, owned by the same user, and must not be
 * YA itself or any of its ancestors. A caller that has previously observed the
 * listener passes its identity back, so a port that changed hands between the
 * observation and the signal is refused rather than signalled.
 *
 * Apps (artifact vhosts) and gateway services both stop processes this way.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Whether this host can identify a port's listener at all. */
export const portListenerControlAvailable =
  process.platform === "linux" && existsSync("/usr/bin/lsof");

export interface ListenerIdentity {
  pid: number;
  /** `/proc` start time: distinguishes a reused pid from the same process. */
  start: string;
}

async function processIdentity(pid: number) {
  const info = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = info.slice(info.lastIndexOf(")") + 2).split(" ");
  return {
    parent: Number(fields[1]),
    start: fields[19]!,
    uid: (await stat(`/proc/${pid}`)).uid,
  };
}

/**
 * The single pid listening on `port`, or null when nothing listens.
 *
 * Throws when the host cannot answer or when several processes listen, because
 * "which one did the user mean" has no safe default.
 */
export async function findPortListener(port: number): Promise<number | null> {
  if (!portListenerControlAvailable) {
    throw new Error("Port listener control is unavailable on this host");
  }
  let output: string;
  try {
    output = (
      await exec(
        "/usr/bin/lsof",
        ["-nP", "-a", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
        { timeout: 3000, maxBuffer: 65536 },
      )
    ).stdout;
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    if (failure.code === 1 && !failure.stdout && !failure.stderr) return null;
    throw error;
  }
  const values = [...new Set(output.trim().split(/\s+/).map(Number))];
  if (
    values.length !== 1 ||
    !Number.isSafeInteger(values[0]) ||
    values[0]! <= 1
  ) {
    throw new Error("Cannot identify a unique listener");
  }
  return values[0]!;
}

/**
 * Identify the listener on `port` and prove it is safe to signal.
 *
 * Returns null when nothing listens. Throws when the listener belongs to
 * another user, or is YA or one of its ancestors — terminating those would take
 * down the server that is asking.
 */
export async function identifySignallableListener(
  port: number,
): Promise<ListenerIdentity | null> {
  const pid = await findPortListener(port);
  if (pid === null) return null;
  const info = await processIdentity(pid);
  if (info.uid !== process.getuid!()) {
    throw new Error("Listener belongs to another user");
  }
  let ancestor = process.pid;
  while (ancestor > 1) {
    if (pid === ancestor) {
      throw new Error("Refusing to stop YA or its parent process");
    }
    ancestor = (await processIdentity(ancestor)).parent;
  }
  return { pid, start: info.start };
}

/** Whether `identity` still names the live process it named when observed. */
export async function listenerStillRunning(
  identity: ListenerIdentity,
): Promise<boolean> {
  return processIdentity(identity.pid).then(
    (info) => info.start === identity.start,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

export interface StopListenerOptions {
  /** Poll interval and attempt count while waiting for the process to exit. */
  pollIntervalMs?: number;
  attempts?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

/**
 * SIGTERM a previously identified listener and wait for the port to be free.
 *
 * Returns true when the port ends up with no listener. Returns false when the
 * process outlived the wait; the caller decides whether that is an error.
 */
export async function stopIdentifiedListener(
  port: number,
  identity: ListenerIdentity,
  options: StopListenerOptions = {},
): Promise<boolean> {
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const attempts = options.attempts ?? 50;
  const delay = options.delay ?? wait;

  process.kill(identity.pid, "SIGTERM");
  for (let attempt = 0; attempt < attempts; attempt++) {
    await delay(pollIntervalMs);
    if (!(await listenerStillRunning(identity))) break;
  }
  return (await findPortListener(port)) === null;
}
