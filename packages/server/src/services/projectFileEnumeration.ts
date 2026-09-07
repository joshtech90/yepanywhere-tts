import { spawn } from "node:child_process";
import { buildGitArgs } from "../git/gitExec.js";

const MAX_RECORD_BYTES = 16 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

/** Consume NUL-delimited Git paths, killing and reaping Git when visit stops. */
export function enumerateProjectFiles(
  project: string,
  args: readonly string[],
  visit: (path: string) => boolean,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn("git", buildGitArgs(project, args), {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let stopped = false;
    let failure: Error | undefined;
    let tail: Buffer = Buffer.alloc(0);
    let oversized = false;
    let stderr = "";
    const stop = () => {
      stopped = true;
      // This read-only child owns no descendants or writes to finish.
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      failure = new Error("File completion enumeration timed out");
      stop();
    }, 10_000);
    timer.unref();
    const abort = () => {
      failure = new Error("File completion enumeration aborted");
      stop();
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      failure = error;
    });
    child.stdout.on("error", (error) => {
      failure = error;
      stop();
    });
    child.stderr.on("error", (error) => {
      failure = error;
      stop();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.subarray(0, MAX_STDERR_BYTES - stderr.length).toString();
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stopped) return;
      let start = 0;
      try {
        while (start < chunk.length) {
          const end = chunk.indexOf(0, start);
          const part = chunk.subarray(start, end < 0 ? chunk.length : end);
          if (tail.length + part.length > MAX_RECORD_BYTES) oversized = true;
          if (!oversized) {
            tail = tail.length ? Buffer.concat([tail, part]) : part;
          }
          if (end < 0) {
            tail = oversized ? Buffer.alloc(0) : Buffer.from(tail);
            break;
          }
          const path = oversized ? "" : tail.toString("utf8");
          tail = Buffer.alloc(0);
          oversized = false;
          if (path && !visit(path)) {
            stop();
            break;
          }
          start = end + 1;
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (stopped) resolve();
      else if (code !== 0)
        reject(
          new Error(
            `Git file enumeration failed (${code ?? signal}): ${stderr}`,
          ),
        );
      else if (tail.length || oversized)
        reject(new Error("Git file enumeration ended with an incomplete path"));
      else resolve();
    });
    child.on("close", () => signal?.removeEventListener("abort", abort));
  });
}
