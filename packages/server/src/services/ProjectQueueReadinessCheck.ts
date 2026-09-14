import { type ChildProcess, execFile, spawn } from "node:child_process";
import {
  isProjectQueueReadinessCommand,
  type ProjectQueueReadinessCommand,
} from "@yep-anywhere/shared";
import { stripVTControlCharacters } from "node:util";
import { stripYaControlPlaneCredentials } from "../sdk/providers/env-filter.js";

export type { ProjectQueueReadinessCommand } from "@yep-anywhere/shared";

const MAX_OUTPUT_BYTES = 8 * 1024;
const MAX_CAPTION_LENGTH = 512;
const MAX_CONCURRENT_CHECKS = 4;

function statusLine(output: string): string {
  return (
    stripVTControlCharacters(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, MAX_CAPTION_LENGTH) ?? ""
  );
}

/** One-shot advisory checks. Null means clear; a string explains the hold. */
export class ProjectQueueReadinessCheck {
  private readonly children = new Set<ChildProcess>();
  private readonly pending = new Set<Promise<string | null>>();
  private readonly terminations = new Set<Promise<void>>();
  private readonly stopping = new WeakSet<ChildProcess>();
  private disposed = false;

  constructor(private readonly timeoutMs = 5_000) {}

  run(
    command: ProjectQueueReadinessCommand,
    projectPath: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (this.disposed) return Promise.resolve("Readiness check stopped");
    if (signal?.aborted)
      return Promise.resolve("Readiness check timed out or was stopped");
    if (this.children.size + this.terminations.size >= MAX_CONCURRENT_CHECKS) {
      return Promise.resolve("Waiting for readiness check capacity");
    }
    if (!isProjectQueueReadinessCommand(command)) {
      return Promise.resolve("Readiness check configuration is invalid");
    }
    const result = new Promise<string | null>((resolve) => {
      let failure: string | null = null;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      const child = spawn(command.executable, command.args, {
        cwd: projectPath,
        env: stripYaControlPlaneCredentials(process.env),
        windowsHide: true,
        shell: false,
        detached: process.platform !== "win32",
      });
      child.stdin.end();
      this.children.add(child);
      const stop = () => {
        failure ??= "Readiness check timed out or was stopped";
        this.stopChild(child);
        // A descendant retaining a pipe must not extend the deadline.
        child.stdout?.destroy();
        child.stderr?.destroy();
      };
      const timeout = setTimeout(stop, this.timeoutMs);
      timeout.unref();
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          failure = "Readiness check exceeded its output limit";
          stop();
        } else {
          chunks.push(chunk);
        }
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", (error: NodeJS.ErrnoException) => {
        failure = `Readiness check failed (${error.code ?? error.message})`;
      });
      child.on("close", (code, exitSignal) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", stop);
        this.stopChild(child);
        this.children.delete(child);
        if (failure) resolve(failure);
        else if (this.disposed)
          resolve("Readiness check timed out or was stopped");
        else if (code === 0) resolve(null);
        else if (code !== null)
          resolve(
            statusLine(Buffer.concat(stdout).toString("utf8")) ||
              statusLine(Buffer.concat(stderr).toString("utf8")) ||
              (code === 1
                ? "Project is not ready"
                : `Readiness check failed (${code})`),
          );
        else
          resolve(`Readiness check failed (${exitSignal ?? "unknown error"})`);
      });
      signal?.addEventListener("abort", stop, { once: true });
      if (signal?.aborted) stop();
    });
    this.pending.add(result);
    void result.then(
      () => this.pending.delete(result),
      () => this.pending.delete(result),
    );
    return result;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const child of this.children) this.stopChild(child);
    await Promise.all(this.pending);
    await Promise.all(this.terminations);
  }

  private stopChild(child: ChildProcess): void {
    if (this.stopping.has(child)) return;
    this.stopping.add(child);
    if (
      process.platform === "win32" &&
      child.pid &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      const termination = new Promise<void>((resolve) => {
        // Windows has no POSIX process groups. Bound the native tree-kill
        // helper, then enforce direct-child/pipe cleanup if it cannot finish.
        execFile(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          {
            timeout: 1000,
            killSignal: "SIGKILL",
            maxBuffer: 1024,
            windowsHide: true,
            env: stripYaControlPlaneCredentials(process.env),
          },
          () => {
            child.kill("SIGKILL");
            child.stdout?.destroy();
            child.stderr?.destroy();
            resolve();
          },
        );
      });
      this.terminations.add(termination);
      void termination.then(() => this.terminations.delete(termination));
      return;
    }
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    child.kill("SIGKILL");
  }
}
