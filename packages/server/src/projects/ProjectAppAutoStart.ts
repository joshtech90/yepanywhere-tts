import { mkdir, readFile } from "node:fs/promises";
import { request } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";
import {
  readProjectService,
  type ProjectServices,
  type ProjectServiceUpstream,
} from "./ProjectServiceManager.js";

// A separate file, not a field on project-apps.json: that store is parsed
// strictly, so an older YA reading a new field would lose every reservation.
const settingSchema = z.strictObject({
  by: z.string().min(1),
  at: z.string(),
});
const fileSchema = z.strictObject({
  version: z.literal(1),
  projects: z.record(z.string(), settingSchema),
});
type AutoStartFile = z.infer<typeof fileSchema>;

/** At most one automatic start per project in this interval. */
export const AUTO_START_MIN_INTERVAL_MS = 30_000;
/** An app unreachable this soon after an automatic start failed it. */
export const AUTO_START_EARLY_FAILURE_MS = 60_000;
export const AUTO_START_FAILURE_WINDOW_MS = 10 * 60_000;
export const AUTO_START_FAILURE_LIMIT = 3;

export interface ProjectAppAutoStartStatus {
  enabled: boolean;
  /** Last failure once automatic starts paused; a manual Start clears it. */
  paused?: string;
}

/** Why an authorized visit found no usable app. */
export type AutoStartCause = "not-running" | "unreachable";

interface Guard {
  lastAttemptAt?: number;
  lastReadyAt?: number;
  failures: number[];
  paused?: string;
  /** First line of the latest failure, shown while starts are held back. */
  lastError?: string;
  inFlight?: Promise<ProjectServiceUpstream | null>;
}

/**
 * Opt-in start of a served process app on an authorized visit
 * (topics/project-service.md § Auto-start on visit), and start of a stopped
 * app its viewer opens in YA (§ Start on open). Both share the rate and
 * crash-loop guards, which are in memory, so a YA restart clears them.
 */
export class ProjectAppAutoStart {
  private state: AutoStartFile = { version: 1, projects: {} };
  private writing: Promise<unknown> = Promise.resolve();
  private readonly guards = new Map<string, Guard>();
  readonly ready: Promise<void>;
  private readonly file: string;

  constructor(
    private readonly directory: string,
    private readonly deps: {
      services: ProjectServices;
      projectPath: (projectId: string) => Promise<string | null>;
      /** Whether the principal who enabled auto-start may still configure it. */
      mayAutoStart: (by: string, projectId: string) => Promise<boolean>;
      now?: () => number;
    },
  ) {
    this.file = join(directory, "project-app-auto-start.json");
    this.ready = this.load();
    void this.ready.catch((error: unknown) =>
      console.error("[ProjectAppAutoStart] State unavailable:", error),
    );
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async load(): Promise<void> {
    try {
      this.state = fileSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private guard(projectId: string): Guard {
    let guard = this.guards.get(projectId);
    if (!guard) {
      guard = { failures: [] };
      this.guards.set(projectId, guard);
    }
    return guard;
  }

  async status(projectId: string): Promise<ProjectAppAutoStartStatus> {
    await this.ready;
    const enabled = Object.hasOwn(this.state.projects, projectId);
    const paused = this.guards.get(projectId)?.paused;
    return { enabled, ...(enabled && paused ? { paused } : {}) };
  }

  set(
    projectId: string,
    enabled: boolean,
    by: string,
    authorize: () => Promise<void>,
  ): Promise<ProjectAppAutoStartStatus> {
    const perform = async () => {
      await this.ready;
      await authorize();
      const next = structuredClone(this.state);
      if (enabled)
        Object.defineProperty(next.projects, projectId, {
          value: { by, at: new Date().toISOString() },
          enumerable: true,
          configurable: true,
          writable: true,
        });
      else delete next.projects[projectId];
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFileAtomically(this.file, JSON.stringify(next));
      this.state = next;
      this.reset(projectId);
      return this.status(projectId);
    };
    const current = this.writing.then(perform, perform);
    this.writing = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  /** A manual start or re-saved setting is a fresh chance. */
  reset(projectId: string): void {
    // In place: an attempt already in flight keeps settling this same guard.
    const guard = this.guards.get(projectId);
    if (!guard) return;
    guard.failures = [];
    guard.paused = undefined;
    guard.lastError = undefined;
    guard.lastAttemptAt = undefined;
    guard.lastReadyAt = undefined;
  }

  /**
   * Start (or, when its port refuses connections, restart) a served process
   * app on an already authorized visit. Resolves to the usable upstream, or
   * null when auto-start is off, rate-limited, paused or failed. Concurrent
   * visits share one attempt.
   */
  async recover(
    projectId: string,
    cause: AutoStartCause,
    current: ProjectServiceUpstream | null,
  ): Promise<ProjectServiceUpstream | null> {
    await this.ready;
    if (!Object.hasOwn(this.state.projects, projectId)) return null;
    return this.guarded(projectId, (guard) =>
      this.attempt(projectId, cause, current, guard),
    );
  }

  /**
   * Start a process app its viewer opened in YA while no launch runs: never
   * started, interrupted by a YA restart, or crashed. Opening the app is the
   * request to run it, so unlike {@link recover} this needs no opt-in and
   * uses the opener's own start authority; an explicit Stop is respected.
   * Shares the loop guard, and throws its reason when no start was made.
   */
  async startForOpen(
    projectId: string,
    projectPath: string,
    authorize: () => Promise<void>,
  ): Promise<void> {
    await this.ready;
    const saved = await this.deps.services.status(projectId);
    if (saved?.desired === "stopped" || saved?.mode === "live-preview") return;
    const started = await this.guarded(projectId, (guard) =>
      this.launch(projectId, projectPath, "not-running", authorize, guard),
    );
    if (started) return;
    const guard = this.guard(projectId);
    throw new Error(
      guard.paused
        ? `Automatic start paused after repeated failures: ${guard.paused}`
        : (guard.lastError ?? "App start was attempted moments ago"),
    );
  }

  private async guarded(
    projectId: string,
    run: (guard: Guard) => Promise<ProjectServiceUpstream | null>,
  ): Promise<ProjectServiceUpstream | null> {
    const guard = this.guard(projectId);
    if (guard.inFlight) return guard.inFlight;
    if (guard.paused) return null;
    const now = this.now();
    // An app that is gone again this soon after an automatic start failed it.
    if (
      guard.lastReadyAt !== undefined &&
      now - guard.lastReadyAt < AUTO_START_EARLY_FAILURE_MS
    ) {
      guard.lastReadyAt = undefined;
      this.fail(guard, `App stopped answering within a minute of starting`);
      if (guard.paused) return null;
    }
    if (
      guard.lastAttemptAt !== undefined &&
      now - guard.lastAttemptAt < AUTO_START_MIN_INTERVAL_MS
    )
      return null;
    const attempt = run(guard);
    guard.inFlight = attempt;
    try {
      return await attempt;
    } finally {
      guard.inFlight = undefined;
    }
  }

  private fail(guard: Guard, message: string): void {
    const now = this.now();
    guard.failures = [
      ...guard.failures.filter((at) => now - at < AUTO_START_FAILURE_WINDOW_MS),
      now,
    ];
    // The first line names the failure; the app's own error keeps the log tail.
    guard.lastError = (message.split("\n")[0] ?? message).slice(0, 300);
    if (guard.failures.length >= AUTO_START_FAILURE_LIMIT)
      guard.paused = guard.lastError;
  }

  private async attempt(
    projectId: string,
    cause: AutoStartCause,
    current: ProjectServiceUpstream | null,
    guard: Guard,
  ): Promise<ProjectServiceUpstream | null> {
    const setting = this.state.projects[projectId];
    if (!setting || !(await this.deps.mayAutoStart(setting.by, projectId)))
      return null;
    const projectPath = await this.deps.projectPath(projectId);
    if (!projectPath) return null;
    const declaration = await readProjectService(projectPath).catch(() => null);
    if (!declaration || !("start" in declaration)) return null;
    // One refused connection is not enough to kill a live app: its own
    // readiness probe must fail too, twice.
    if (cause === "unreachable" && current) {
      for (let tries = 0; tries < 2; tries++)
        if (await probe(current, declaration.status)) return current;
    }
    return this.launch(
      projectId,
      projectPath,
      cause,
      async () => {
        if (!(await this.deps.mayAutoStart(setting.by, projectId)))
          throw new Error("Auto-start is no longer permitted");
      },
      guard,
    );
  }

  private async launch(
    projectId: string,
    projectPath: string,
    cause: AutoStartCause,
    authorize: () => Promise<void>,
    guard: Guard,
  ): Promise<ProjectServiceUpstream | null> {
    guard.lastAttemptAt = this.now();
    try {
      if (cause === "unreachable")
        await this.deps.services.stop(projectId, authorize);
      await this.deps.services.start(projectId, projectPath, authorize);
      const upstream = await this.deps.services.upstream(projectId);
      if (!upstream) throw new Error("App started without a usable address");
      guard.lastReadyAt = this.now();
      console.info(`[ProjectAppAutoStart] Started ${projectId} (${cause})`);
      return upstream;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fail(guard, message);
      console.warn(
        `[ProjectAppAutoStart] Start failed for ${projectId}${guard.paused ? "; paused" : ""}:`,
        message,
      );
      return null;
    }
  }

  close(): Promise<unknown> {
    return this.writing;
  }
}

function probe(
  upstream: ProjectServiceUpstream,
  status: { path: string; readyStatus: number },
): Promise<boolean> {
  const path = upstream.basePath
    ? `${upstream.basePath}${status.path.slice(1)}`
    : status.path;
  return new Promise((done) => {
    const req = request(
      {
        createConnection: () => {
          const socket = connect(upstream.brokerSocket);
          socket.write(`${upstream.port}\n`);
          return socket;
        },
        path,
        method: "GET",
        headers: { host: `127.0.0.1:${upstream.port}` },
      },
      (response) => {
        const ready = response.statusCode === status.readyStatus;
        response.destroy();
        done(ready);
      },
    );
    req.setTimeout(1000, () => req.destroy());
    req.once("error", () => done(false));
    req.once("close", () => done(false));
    req.end();
  });
}
