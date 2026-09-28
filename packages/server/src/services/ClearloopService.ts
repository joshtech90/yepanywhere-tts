/**
 * `/clearloop N M: <prompt>` — a server-owned job that rewinds a session to
 * a cut and re-sends one prompt M times, ending each iteration after a
 * server-wide inactivity window. Contract: topics/session-rewind.md.
 *
 * The service owns the state machine and the inactivity timer. Rewinding and
 * sending are route-owned operations injected through `ClearloopRunner`
 * because they reuse the session routes' boundary resolution and resume
 * settings.
 */

import { randomUUID } from "node:crypto";
import type {
  DurableLocalCommandMessage,
  SessionClearloopBadge,
  SessionClearloopJob,
  SessionClearloopState,
  SessionProviderRetentionSnapshot,
  SessionQueuedClearloopProgress,
  UrlProjectId,
} from "@yep-anywhere/shared";
import type { SessionMetadataService } from "../metadata/SessionMetadataService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { getLogger } from "../logging/logger.js";
import type { EventBus } from "../watcher/EventBus.js";

export interface ClearloopRunner {
  /** Rewind the session to the job's cut. `noop` when the cut is the tail. */
  rewind(input: {
    sessionId: string;
    projectId: UrlProjectId;
    job: SessionClearloopJob;
    iteration: number;
  }): Promise<"rewound" | "noop">;
  /** Resume the session with the job's prompt as an ordinary direct turn. */
  send(input: {
    sessionId: string;
    projectId: UrlProjectId;
    job: SessionClearloopJob;
  }): Promise<void>;
}

export interface ClearloopServiceOptions {
  getSupervisor: () => Supervisor;
  sessionMetadataService: SessionMetadataService;
  eventBus?: EventBus;
  /** Current server-wide inactivity window, read at every boundary. */
  getInactivitySeconds: () => number;
  /**
   * Project idle predicate for patient loops: Project Queue's, without its
   * readiness check, and blocked while that queue is about to promote an
   * item. Absent when this server has no Project Queue, which is what makes
   * a loop refuse to become patient rather than silently run impatiently.
   */
  getProjectIdleStatus?: (
    projectId: UrlProjectId,
  ) => Promise<{ idle: boolean; blockers: string[] }>;
  /** How often a held patient loop re-asks; defaults to five seconds. */
  patientRecheckMs?: number;
  /** Background-task hold limit; defaults to CLEARLOOP_BACKGROUND_HOLD_MAX_MS. */
  backgroundHoldMaxMs?: number;
  /** Busy re-check cadence; defaults to five seconds. */
  busyRecheckMs?: number;
}

export interface StartClearloopParams {
  cutMessageId: string;
  cutTurnIndex: number;
  prompt: string;
  total: number;
  commandText: string;
  /** Start waiting on project idleness too (a Project Queue-delivered loop). */
  patient?: boolean;
}

/** While the provider is busy the due time is unknown; look again soon. */
const BUSY_RECHECK_MS = 5_000;

/** Default cadence for a held patient loop's project re-check. */
const PATIENT_RECHECK_MS = 5_000;

/**
 * Longest a boundary waits on Claude background tasks alone. A task that
 * never exits (a dev server started in the background) must not hold the
 * loop forever; past this the rewind stops the process and its tasks.
 */
export const CLEARLOOP_BACKGROUND_HOLD_MAX_MS = 30 * 60_000;

/** Consecutive failed attempts at one iteration before the loop gives up. */
export const CLEARLOOP_MAX_CONSECUTIVE_FAILURES = 3;

interface LoopContext {
  projectId: UrlProjectId;
  timer: NodeJS.Timeout | null;
  /**
   * The single-flight claim on beginning an iteration, from the boundary's
   * record write through the send. Taken synchronously; see `runExclusive`.
   */
  working: boolean;
  /** True while the loop's own rewind may stop the live process. */
  rewinding: boolean;
  /** Project blockers from the last patient check, for the chip's caption. */
  projectBlockers?: string[];
  /** When the boundary began waiting on background tasks alone. */
  backgroundHoldSince?: number;
  /** Consecutive failed attempts at the current iteration. */
  failures: number;
  /** After a failure the next boundary retries the iteration, not the next. */
  retryPending: boolean;
  /** The last failure restarts the inactivity countdown from zero. */
  failedAtMs?: number;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Claude background tasks still running. Session crons are excluded: they
 * persist for the process's lifetime, so waiting on them would never end.
 */
function liveBackgroundTaskCount(
  retention: SessionProviderRetentionSnapshot | undefined,
): number {
  if (!retention) return 0;
  return (retention.backgroundTaskCount ?? 0) + (retention.liveTaskCount ?? 0);
}

/**
 * Looks up the clearloop badge for a session's summary row: present only
 * while this server runs the session's loop. Surfaces without a clearloop
 * service leave it absent, since no loop can run there.
 */
export type ClearloopBadgeResolver = (
  sessionId: string,
) => SessionClearloopBadge | undefined;

/** Badge fields for a loop this server is running. */
function badgeForLiveJob(
  job: SessionClearloopJob,
  windowSeconds: number,
): SessionClearloopBadge {
  return {
    remaining: Math.max(0, job.total - job.completed),
    total: job.total,
    completed: job.completed,
    cutTurnIndex: job.cutTurnIndex,
    prompt: job.prompt,
    windowSeconds,
    ...(job.patient ? { patient: true } : {}),
  };
}

export class ClearloopService {
  private runner: ClearloopRunner | null = null;
  private readonly contexts = new Map<string, LoopContext>();

  constructor(private readonly options: ClearloopServiceOptions) {
    options.eventBus?.subscribe((event) => {
      if (event.type === "session-metadata-changed") {
        // The provider refused the iteration's rewind, so the dropped turns
        // are live again and the iteration is retried. A refusal during the
        // loop's own launch also fails that send, which already counts it.
        const context = this.contexts.get(event.sessionId);
        if (
          event.rewindRecordRemoved &&
          context &&
          !context.working &&
          !context.retryPending
        ) {
          void this.handleIterationFailure(
            event.sessionId,
            "The provider refused the rewind; the dropped turns were kept",
          );
        }
        return;
      }
      if (event.type === "session-aborted") {
        // The loop's own rewind aborts the live process to arm the truncating
        // resume; only a stop it did not request ends the loop.
        if (this.contexts.get(event.sessionId)?.rewinding) return;
        // An idle reap tears down a quiet process for want of viewers. The
        // session is still waiting out the inactivity window; the next
        // iteration's send starts a fresh process as it would anyway.
        if (event.reason === "idle-reap") return;
      } else if (event.type !== "session-stop-requested") {
        return;
      }
      // A stop request is never the loop's own: the rewind aborts rather than
      // interrupting, so this one always came from outside the loop.
      void this.interrupt(event.sessionId, "Session was stopped");
    });
  }

  setRunner(runner: ClearloopRunner): void {
    this.runner = runner;
  }

  /**
   * Loop state does not survive a server restart: a record left `running`
   * belongs to a previous server process and can never advance. Mark each
   * one interrupted with the usual durable notice so history says how it
   * ended. Called once after session metadata has loaded. Never rejects: a
   * record whose write fails is logged and left for the next start, and
   * still shows no badge, since only a loop this server runs has one.
   */
  async reconcileAfterRestart(): Promise<void> {
    const sessionIds =
      this.options.sessionMetadataService.listSessionIdsWithRunningClearloop?.() ??
      [];
    for (const sessionId of sessionIds) {
      if (this.contexts.has(sessionId)) continue;
      const job = this.options.sessionMetadataService.getClearloop(sessionId);
      if (job?.state !== "running") continue;
      try {
        await this.finish(
          sessionId,
          "interrupted",
          "Server restarted while the loop was running",
        );
      } catch (error) {
        getLogger().warn(
          {
            event: "clearloop_restart_reconcile_failed",
            sessionId,
            message: error instanceof Error ? error.message : String(error),
          },
          "Clearloop restart reconcile failed for a leftover running loop",
        );
      }
    }
  }

  /** The job the queue projection should show, or undefined. */
  getRunningJob(sessionId: string): SessionClearloopJob | undefined {
    const job = this.options.sessionMetadataService.getClearloop(sessionId);
    if (job?.state !== "running") return undefined;
    // A running record without a live context is a leftover from a previous
    // server process; it can never advance, so it is not shown as running.
    return this.contexts.has(sessionId) ? job : undefined;
  }

  isRunning(sessionId: string): boolean {
    return this.getRunningJob(sessionId) !== undefined;
  }

  /**
   * Badge data for every session-summary surface (title chip, sidebar,
   * Agents), or undefined when this server runs no loop for the session.
   */
  getBadge(sessionId: string): SessionClearloopBadge | undefined {
    const job = this.getRunningJob(sessionId);
    return job
      ? badgeForLiveJob(job, this.options.getInactivitySeconds())
      : undefined;
  }

  async start(
    sessionId: string,
    projectId: UrlProjectId,
    params: StartClearloopParams,
  ): Promise<SessionClearloopJob> {
    if (!this.runner) {
      throw new Error("clearloop runner is not configured");
    }
    if (this.isRunning(sessionId)) {
      throw new ClearloopConflictError(
        "A /clearloop is already running in this session",
      );
    }
    const job: SessionClearloopJob = {
      id: randomUUID(),
      cutMessageId: params.cutMessageId,
      cutTurnIndex: params.cutTurnIndex,
      prompt: params.prompt,
      total: params.total,
      completed: 0,
      state: "running",
      ...(params.patient ? { patient: true } : {}),
      startedAt: new Date().toISOString(),
      commandText: params.commandText,
    };
    // The first iteration holds the claim from creation: the record reads
    // as running as soon as it is written, before its flush settles.
    const context: LoopContext = {
      projectId,
      timer: null,
      working: true,
      rewinding: false,
      failures: 0,
      retryPending: false,
    };
    this.contexts.set(sessionId, context);
    try {
      await this.persist(sessionId, job);
    } catch (error) {
      context.working = false;
      throw error;
    }
    void this.iterate(sessionId).finally(() => {
      context.working = false;
    });
    return job;
  }

  /**
   * Stop without touching in-flight provider work: the current iteration
   * finishes on its own and no further rewind happens.
   */
  async cancel(sessionId: string): Promise<SessionClearloopJob | undefined> {
    if (!this.getRunningJob(sessionId)) return undefined;
    return this.finish(sessionId, "cancelled");
  }

  /**
   * Turn the project-idle wait on or off for the next boundary. The current
   * iteration is untouched: patience decides when the *next* rewind happens,
   * so the change lands at the boundary the loop has not reached yet.
   */
  async setPatience(
    sessionId: string,
    patient: boolean,
  ): Promise<SessionClearloopJob | undefined> {
    const job = this.getRunningJob(sessionId);
    if (!job) return undefined;
    if (patient && !this.options.getProjectIdleStatus) {
      throw new ClearloopConflictError(
        "This server cannot report project idleness, so the loop cannot wait for it",
      );
    }
    if ((job.patient ?? false) === patient) return job;
    if (!patient) {
      const context = this.contexts.get(sessionId);
      if (context) context.projectBlockers = undefined;
    }
    const updated = await this.update(sessionId, { patient });
    // Either direction can change whether the boundary is already due.
    this.scheduleCheck(sessionId, 0);
    return updated;
  }

  /**
   * End the current iteration now, skipping both the remaining inactivity
   * window and any project wait. In-flight rewind/send work still wins: the
   * loop refuses rather than overlapping itself.
   */
  async startNow(sessionId: string): Promise<SessionClearloopJob | undefined> {
    const context = this.contexts.get(sessionId);
    const job = this.getRunningJob(sessionId);
    if (!context || !job) return undefined;
    const boundary = this.runExclusive(context, () => {
      if (context.timer) {
        clearTimeout(context.timer);
        context.timer = null;
      }
      context.projectBlockers = undefined;
      return this.endBoundary(sessionId, context);
    });
    if (!boundary) {
      throw new ClearloopConflictError(
        "The loop is already starting an iteration",
      );
    }
    await boundary;
    return this.getRunningJob(sessionId) ?? job;
  }

  async interrupt(
    sessionId: string,
    error: string,
  ): Promise<SessionClearloopJob | undefined> {
    if (!this.getRunningJob(sessionId)) return undefined;
    return this.finish(sessionId, "interrupted", error);
  }

  /** Rewind and send the next iteration. Runs under the single-flight claim. */
  private async iterate(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    const job = this.getRunningJob(sessionId);
    if (!context || !job || !this.runner) return;
    if (job.completed >= job.total) {
      await this.finish(sessionId, "completed");
      return;
    }
    const iteration = job.completed + 1;
    try {
      context.rewinding = true;
      try {
        await this.runner.rewind({
          sessionId,
          projectId: context.projectId,
          job,
          iteration,
        });
      } finally {
        context.rewinding = false;
      }
      // Cancel may have landed while rewinding.
      if (!this.getRunningJob(sessionId)) return;
      const sending = await this.update(sessionId, {
        currentIteration: iteration,
        iterationSentAt: new Date().toISOString(),
      });
      await this.runner.send({
        sessionId,
        projectId: context.projectId,
        job: sending,
      });
      context.failures = 0;
      context.failedAtMs = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      getLogger().warn(
        { event: "clearloop_iteration_failed", sessionId, iteration, message },
        "clearloop iteration failed",
      );
      await this.handleIterationFailure(sessionId, message);
      return;
    }
    this.scheduleCheck(sessionId, this.options.getInactivitySeconds() * 1000);
  }

  /**
   * Take the single-flight claim and hold it until `work` settles, or return
   * undefined when an iteration already holds it. The claim is taken before
   * `work` first awaits, so a Start now and a timer-driven check cannot both
   * pass their guards while the other is still writing the boundary.
   */
  private runExclusive(
    context: LoopContext,
    work: () => Promise<void>,
  ): Promise<void> | undefined {
    if (context.working) return undefined;
    context.working = true;
    return work().finally(() => {
      context.working = false;
    });
  }

  /**
   * A failed iteration (its rewind, its launch, or a refused truncation) is
   * retried after a fresh inactivity window; the send resumes the provider
   * process when none is attached. Only repeated failure ends the loop.
   */
  private async handleIterationFailure(
    sessionId: string,
    message: string,
  ): Promise<void> {
    const context = this.contexts.get(sessionId);
    const job = this.getRunningJob(sessionId);
    if (!context || !job) return;
    context.failures += 1;
    if (context.failures >= CLEARLOOP_MAX_CONSECUTIVE_FAILURES) {
      await this.finish(sessionId, "interrupted", message);
      return;
    }
    context.retryPending = true;
    context.failedAtMs = Date.now();
    await this.writeLocalNotice(
      sessionId,
      `${job.commandText} — iteration ${job.completed + 1} failed; retrying after the inactivity window (failure ${context.failures} of ${CLEARLOOP_MAX_CONSECUTIVE_FAILURES})`,
      message,
    );
    this.publishQueueEntry(sessionId);
    this.scheduleCheck(sessionId, this.options.getInactivitySeconds() * 1000);
  }

  private scheduleCheck(sessionId: string, delayMs: number): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    if (context.timer) clearTimeout(context.timer);
    const timer = setTimeout(
      () => {
        context.timer = null;
        void this.check(sessionId);
      },
      Math.max(250, delayMs),
    );
    timer.unref?.();
    context.timer = timer;
  }

  /**
   * When the session last did anything (user send, provider progress, a
   * failed attempt), or `busy` while a turn is running and the due time is
   * unknown. Claude background tasks still running also keep the session
   * busy, so the rewind neither kills them nor drops the turn their
   * notification would start, until the hold limit has passed.
   */
  private readQuietAnchor(
    sessionId: string,
    job: SessionClearloopJob,
    now: number,
  ):
    | { busy: true; backgroundTasks: number }
    | { busy: false; anchorMs: number; backgroundTasks: number } {
    const process = this.options
      .getSupervisor()
      .getProcessForSession(sessionId);
    const context = this.contexts.get(sessionId);
    const candidates: number[] = [];
    const sentAt = parseIsoMs(job.iterationSentAt);
    if (sentAt !== null) candidates.push(sentAt);
    if (context?.failedAtMs !== undefined) candidates.push(context.failedAtMs);
    let backgroundTasks = 0;
    if (process) {
      if (process.state.type === "in-turn" || process.queueDepth > 0) {
        return { busy: true, backgroundTasks };
      }
      const liveness = process.getLivenessSnapshot(new Date(now));
      backgroundTasks = liveBackgroundTaskCount(liveness.providerRetention);
      const holdSince = context?.backgroundHoldSince;
      if (
        backgroundTasks > 0 &&
        (holdSince === undefined ||
          now - holdSince <
            (this.options.backgroundHoldMaxMs ??
              CLEARLOOP_BACKGROUND_HOLD_MAX_MS))
      ) {
        return { busy: true, backgroundTasks };
      }
      const state = process.state;
      for (const value of [
        state.type === "idle" ? state.since.getTime() : null,
        parseIsoMs(liveness.lastProviderMessageAt ?? undefined),
        parseIsoMs(liveness.lastRawProviderEventAt ?? undefined),
      ]) {
        if (value !== null) candidates.push(value);
      }
    }
    return {
      busy: false,
      anchorMs: candidates.length > 0 ? Math.max(...candidates) : now,
      backgroundTasks,
    };
  }

  /** Queue-entry progress for the running loop, with the countdown anchor. */
  getProgress(sessionId: string): SessionQueuedClearloopProgress | undefined {
    const job = this.getRunningJob(sessionId);
    if (!job) return undefined;
    const quiet = this.readQuietAnchor(sessionId, job, Date.now());
    const blockers = this.contexts.get(sessionId)?.projectBlockers;
    return {
      completed: job.completed,
      total: job.total,
      state: job.state,
      ...(quiet.busy
        ? {}
        : {
            quietSince: new Date(quiet.anchorMs).toISOString(),
            windowSeconds: this.options.getInactivitySeconds(),
          }),
      ...(job.patient ? { patient: true } : {}),
      ...(blockers?.length ? { projectBlockers: blockers } : {}),
    };
  }

  /** End the iteration once the session has been quiet for the window. */
  private async check(sessionId: string): Promise<void> {
    const context = this.contexts.get(sessionId);
    const job = this.getRunningJob(sessionId);
    if (!context || !job || context.working) return;
    const now = Date.now();
    const windowMs = this.options.getInactivitySeconds() * 1000;
    const quiet = this.readQuietAnchor(sessionId, job, now);
    // The hold limit runs from the first check that found the session
    // waiting on background tasks alone; a running turn or no remaining
    // task resets it (a turn reports no task count).
    if (quiet.backgroundTasks === 0) {
      context.backgroundHoldSince = undefined;
    } else if (quiet.busy) {
      context.backgroundHoldSince ??= now;
    }
    // Every check republishes the entry so clients see the busy/quiet
    // transition and can count down from the current anchor.
    this.publishQueueEntry(sessionId);
    if (quiet.busy) {
      this.scheduleCheck(
        sessionId,
        this.options.busyRecheckMs ?? BUSY_RECHECK_MS,
      );
      return;
    }
    const dueInMs = quiet.anchorMs + windowMs - now;
    if (dueInMs > 0) {
      this.scheduleCheck(sessionId, dueInMs);
      return;
    }
    if (job.patient && !(await this.projectIsIdle(sessionId, context))) {
      this.publishQueueEntry(sessionId);
      this.scheduleCheck(
        sessionId,
        this.options.patientRecheckMs ?? PATIENT_RECHECK_MS,
      );
      return;
    }
    // Cancel, a stop, a patience change, or Start now may have landed during
    // the idle read.
    if (this.getRunningJob(sessionId) !== job) return;
    await this.runExclusive(context, () =>
      this.endBoundary(sessionId, context),
    );
  }

  /**
   * Retry a failed iteration, or close out the finished one and begin the
   * next. Runs under the single-flight claim.
   */
  private async endBoundary(
    sessionId: string,
    context: LoopContext,
  ): Promise<void> {
    context.backgroundHoldSince = undefined;
    if (context.retryPending) {
      context.retryPending = false;
    } else {
      await this.update(sessionId, (current) => ({
        completed: current.completed + 1,
        currentIteration: undefined,
      }));
    }
    await this.iterate(sessionId);
  }

  /**
   * Whether the project is quiet enough for a patient loop's next iteration.
   * Blockers naming this session are dropped: the loop's own quiescence is
   * what the inactivity window already measured, and counting it here would
   * hold the loop against itself.
   */
  private async projectIsIdle(
    sessionId: string,
    context: LoopContext,
  ): Promise<boolean> {
    const read = this.options.getProjectIdleStatus;
    if (!read) {
      context.projectBlockers = undefined;
      return true;
    }
    const status = await read(context.projectId);
    const blockers = status.blockers.filter(
      (blocker) => !blocker.startsWith(`${sessionId}:`),
    );
    context.projectBlockers = blockers.length > 0 ? blockers : undefined;
    return blockers.length === 0;
  }

  private async finish(
    sessionId: string,
    state: Exclude<SessionClearloopState, "running">,
    error?: string,
  ): Promise<SessionClearloopJob> {
    const context = this.contexts.get(sessionId);
    if (context?.timer) clearTimeout(context.timer);
    this.contexts.delete(sessionId);
    const finished = await this.update(sessionId, {
      state,
      endedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    });
    await this.writeNotice(sessionId, finished);
    return finished;
  }

  /**
   * Change the loop's durable record as it is at write time. A caller's own
   * snapshot can be seconds old (a rewind stops the process first), and
   * writing a spread of it would revert a concurrent change such as a
   * patience toggle. Reading and writing the in-memory record is one
   * synchronous step; only the flush awaits.
   */
  private async update(
    sessionId: string,
    patch:
      | Partial<SessionClearloopJob>
      | ((current: SessionClearloopJob) => Partial<SessionClearloopJob>),
  ): Promise<SessionClearloopJob> {
    const current = this.options.sessionMetadataService.getClearloop(sessionId);
    if (!current) {
      throw new Error(`No clearloop record for session ${sessionId}`);
    }
    const next: SessionClearloopJob = {
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    };
    await this.persist(sessionId, next);
    return next;
  }

  /** Write a whole record; changes to an existing one go through `update`. */
  private async persist(
    sessionId: string,
    job: SessionClearloopJob,
  ): Promise<void> {
    await this.options.sessionMetadataService.setClearloop(sessionId, job);
    const context = this.contexts.get(sessionId);
    this.options.eventBus?.emit({
      type: "session-metadata-changed",
      sessionId,
      ...(context ? { projectId: context.projectId } : {}),
      clearloop:
        job.state === "running" && context
          ? badgeForLiveJob(job, this.options.getInactivitySeconds())
          : null,
      timestamp: new Date().toISOString(),
    });
    this.publishQueueEntry(sessionId);
  }

  /**
   * A live process republishes the queue projection so the m/M badge and
   * countdown update without a reload; a dead session refreshes on its next
   * read.
   */
  private publishQueueEntry(sessionId: string): void {
    this.options
      .getSupervisor()
      .getProcessForSession(sessionId)
      ?.notifyQueueProjectionChanged("clearloop");
  }

  /** Durable session-history notice for every terminal state. */
  private async writeNotice(
    sessionId: string,
    job: SessionClearloopJob,
  ): Promise<void> {
    const remaining = job.total - job.completed;
    const summary =
      job.state === "completed"
        ? `${job.commandText} — completed ${job.completed} of ${job.total}`
        : `${job.commandText} — ${job.state} after ${job.completed} of ${job.total}, ${remaining} remaining`;
    await this.writeLocalNotice(sessionId, summary, job.error);
  }

  /** A durable session-history row; an error is shown without a click. */
  private async writeLocalNotice(
    sessionId: string,
    content: string,
    error?: string,
  ): Promise<void> {
    const id = randomUUID();
    const notice: DurableLocalCommandMessage = {
      type: "system",
      subtype: "local_command",
      content,
      ...(error ? { details: [error], detailsOpen: true } : {}),
      timestamp: new Date().toISOString(),
      uuid: id,
      id,
      session_id: sessionId,
      isSynthetic: true,
    };
    await this.options.sessionMetadataService.addLocalCommandMessage(
      sessionId,
      notice,
    );
  }
}

export class ClearloopConflictError extends Error {}
