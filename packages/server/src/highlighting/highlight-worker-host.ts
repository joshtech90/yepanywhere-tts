/**
 * Main-thread owner of the recyclable Shiki highlighting worker.
 *
 * Shiki's Oniguruma WebAssembly memory grows with loaded grammars and input
 * size and never shrinks, and every highlighter dropped without `dispose()`
 * strands its scanners in that memory (6–30 MB each). Running the only
 * highlighter in a worker bounds both: the worker reports its isolate's
 * external memory after each job, and the host retires it past a memory
 * budget, a job count, or an idle period. Terminating the worker releases its
 * whole isolate, WebAssembly memory included.
 *
 * Jobs queue on the main thread and the worker receives one at a time, so a
 * worker that crosses its budget is retired after that job, never after a
 * backlog, and at most one worker is alive. A worker that crashes or does not
 * answer a job in time is terminated; only that job rejects, with
 * `HighlightWorkerUnavailableError`, and the queue continues on a fresh
 * worker. Callers render unhighlighted output instead and must not retain it
 * as final. Tokenizing off the main thread also stops large files from
 * blocking the event loop.
 */

import { Worker } from "node:worker_threads";
import { runOutsideRequestContext } from "../lib/outsideRequestContext.js";
import { registerIdleSweep } from "../lib/processIdleSweep.js";
import { getLogger } from "../logging/logger.js";

const DEFAULT_MAX_EXTERNAL_MB = 192;
const DEFAULT_MAX_JOBS = 10_000;
const DEFAULT_IDLE_MS = 5 * 60 * 1000;
/** Longest one job may run before its worker is treated as stalled. */
const DEFAULT_STALL_MS = 30 * 1000;

const WORKER_URL = new URL("./highlight-worker.mjs", import.meta.url);

/**
 * Highlighting was unavailable (worker crash, stall, or shutdown) rather than
 * impossible for this input; a later attempt may succeed.
 */
export class HighlightWorkerUnavailableError extends Error {
  override name = "HighlightWorkerUnavailableError";
}

export interface HighlightWorkerHostOptions {
  /** Retire the worker once its isolate's external memory exceeds this. */
  maxExternalBytes?: number;
  /** Retire the worker after this many completed jobs. */
  maxJobs?: number;
  /** Retire a worker idle this long, checked by the process idle sweep. */
  idleMs?: number;
  /** Terminate a worker that does not answer one job for this long. */
  stallMs?: number;
  workerUrl?: URL;
}

export interface HighlightWorkerStats {
  live: boolean;
  pendingJobs: number;
  jobsOnCurrentWorker: number;
  lastExternalBytes: number;
  maxExternalBytes: number;
  workersStarted: number;
  workersRetired: number;
  workersFailed: number;
}

interface Job {
  id: number;
  code: string;
  lang: string;
  codeClass?: string;
  resolve: (html: string) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  /** The one job the worker is running, if any. */
  job: Job | null;
  completedJobs: number;
  externalBytes: number;
  stallTimer: NodeJS.Timeout | null;
}

interface WorkerReply {
  id: number;
  html?: string;
  error?: string;
  externalBytes?: number;
}

export class HighlightWorkerHost {
  private readonly maxExternalBytes: number;
  private readonly maxJobs: number;
  private readonly idleMs: number;
  private readonly stallMs: number;
  private readonly workerUrl: URL;
  private current: WorkerSlot | null = null;
  private readonly queue: Job[] = [];
  private unregisterIdleSweep: (() => void) | null = null;
  private lastActivityAt = 0;
  private nextJobId = 1;
  private workersStarted = 0;
  private workersRetired = 0;
  private workersFailed = 0;

  constructor(options: HighlightWorkerHostOptions = {}) {
    this.maxExternalBytes =
      options.maxExternalBytes ??
      resolveMaxExternalBytesFromEnv() ??
      DEFAULT_MAX_EXTERNAL_MB * 1024 * 1024;
    this.maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.stallMs = options.stallMs ?? DEFAULT_STALL_MS;
    this.workerUrl = options.workerUrl ?? WORKER_URL;
  }

  /**
   * Highlight `code` as `lang` (a Shiki bundled language id). `codeClass`, when
   * given, is added to the `<code>` element. Rejects when the language cannot
   * load, or with `HighlightWorkerUnavailableError` when the worker fails;
   * callers render plain output instead.
   */
  highlight(code: string, lang: string, codeClass?: string): Promise<string> {
    this.lastActivityAt = Date.now();
    return new Promise<string>((resolve, reject) => {
      this.queue.push({
        id: this.nextJobId++,
        code,
        lang,
        codeClass,
        resolve,
        reject,
      });
      this.dispatch();
    });
  }

  getStats(): HighlightWorkerStats {
    return {
      live: this.current !== null,
      pendingJobs: this.queue.length + (this.current?.job ? 1 : 0),
      jobsOnCurrentWorker: this.current?.completedJobs ?? 0,
      lastExternalBytes: this.current?.externalBytes ?? 0,
      maxExternalBytes: this.maxExternalBytes,
      workersStarted: this.workersStarted,
      workersRetired: this.workersRetired,
      workersFailed: this.workersFailed,
    };
  }

  /** Terminate the worker, rejecting its job and every queued job. */
  async close(): Promise<void> {
    const slot = this.current;
    const error = new HighlightWorkerUnavailableError(
      "Highlight worker closed",
    );
    this.rejectQueue(error);
    if (!slot) return;
    this.setCurrent(null);
    this.clearStallTimer(slot);
    slot.job?.reject(error);
    slot.job = null;
    await slot.worker.terminate();
  }

  /** Send the next queued job to the worker when it is free. */
  private dispatch(): void {
    if (this.queue.length === 0) return;
    const slot = this.current ?? this.spawn();
    if (slot.job) return;
    const job = this.queue.shift() as Job;
    slot.job = job;
    slot.stallTimer = setTimeout(() => {
      slot.stallTimer = null;
      this.onFailure(slot, new Error("Highlight worker stalled"));
    }, this.stallMs);
    slot.stallTimer.unref();
    // A running job keeps the process alive like any pending I/O; an idle
    // worker does not.
    slot.worker.ref();
    slot.worker.postMessage({
      id: job.id,
      code: job.code,
      lang: job.lang,
      codeClass: job.codeClass,
    });
  }

  private spawn(): WorkerSlot {
    // Usually first reached inside a request; the worker and its message
    // handlers must not capture that request's context.
    const worker = runOutsideRequestContext(() => new Worker(this.workerUrl));
    worker.unref();
    const slot: WorkerSlot = {
      worker,
      job: null,
      completedJobs: 0,
      externalBytes: 0,
      stallTimer: null,
    };
    worker.on("message", (reply: WorkerReply) => this.onReply(slot, reply));
    worker.on("error", (error) => this.onFailure(slot, error));
    worker.on("exit", (code) =>
      this.onFailure(slot, new Error(`Highlight worker exited (${code})`)),
    );
    this.setCurrent(slot);
    this.workersStarted += 1;
    return slot;
  }

  private onReply(slot: WorkerSlot, reply: WorkerReply): void {
    // Unref on every reply: delivering a message also refs the worker's port
    // (observed on Node 24). dispatch() refs it again for the next job.
    slot.worker.unref();
    const job = slot.job;
    if (!job || job.id !== reply.id) return;
    slot.job = null;
    this.clearStallTimer(slot);
    slot.completedJobs += 1;
    this.lastActivityAt = Date.now();
    if (typeof reply.externalBytes === "number") {
      slot.externalBytes = reply.externalBytes;
    }
    if (reply.html !== undefined) {
      job.resolve(reply.html);
    } else {
      job.reject(new Error(reply.error ?? "Highlight failed"));
    }

    if (
      slot === this.current &&
      (slot.externalBytes > this.maxExternalBytes ||
        slot.completedJobs >= this.maxJobs)
    ) {
      this.retire(slot, "budget");
    }
    this.dispatch();
  }

  /** Terminate an idle worker; the next job starts a fresh one. */
  private retire(slot: WorkerSlot, reason: "budget" | "idle"): void {
    this.setCurrent(null);
    this.workersRetired += 1;
    getLogger().debug(
      {
        event: "highlight_worker_retire",
        reason,
        completedJobs: slot.completedJobs,
        externalBytes: slot.externalBytes,
      },
      "HIGHLIGHT: retiring worker",
    );
    void slot.worker.terminate();
  }

  private onFailure(slot: WorkerSlot, cause: Error): void {
    // A retired or closed worker's exit arrives after it was replaced.
    if (slot !== this.current) return;
    this.setCurrent(null);
    this.clearStallTimer(slot);
    void slot.worker.terminate();
    this.workersFailed += 1;
    // A worker that never completed a job may be unable to start at all;
    // fail the queue instead of respawning once per queued job.
    const startupFailure = slot.completedJobs === 0;
    getLogger().warn(
      {
        event: "highlight_worker_failed",
        queuedJobs: this.queue.length,
        startupFailure,
        error: cause.message,
      },
      "HIGHLIGHT: worker failed",
    );
    const error = new HighlightWorkerUnavailableError(cause.message);
    slot.job?.reject(error);
    slot.job = null;
    if (startupFailure) this.rejectQueue(error);
    else this.dispatch();
  }

  private rejectQueue(error: Error): void {
    const jobs = this.queue.splice(0);
    for (const job of jobs) job.reject(error);
  }

  private clearStallTimer(slot: WorkerSlot): void {
    if (slot.stallTimer) clearTimeout(slot.stallTimer);
    slot.stallTimer = null;
  }

  /** Track the live worker; the idle sweep is registered only while one exists. */
  private setCurrent(slot: WorkerSlot | null): void {
    this.current = slot;
    if (slot) {
      this.unregisterIdleSweep ??= registerIdleSweep((now) =>
        this.sweepIdle(now),
      );
    } else {
      this.unregisterIdleSweep?.();
      this.unregisterIdleSweep = null;
    }
  }

  private sweepIdle(now: number): void {
    const slot = this.current;
    if (!slot || slot.job || this.queue.length > 0) return;
    if (now - this.lastActivityAt < this.idleMs) return;
    this.retire(slot, "idle");
  }
}

function resolveMaxExternalBytesFromEnv(): number | null {
  const raw = process.env.YEP_HIGHLIGHT_WORKER_MAX_MB;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 * 1024 : null;
}

/** Process-wide singleton shared by every highlighting path. */
export const highlightWorker = new HighlightWorkerHost();
