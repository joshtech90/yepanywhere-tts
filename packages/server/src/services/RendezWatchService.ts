import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getLogger } from "../logging/logger.js";
import {
  RendezConflictError,
  RendezObserver,
  type RendezSessions,
  type RendezWatchBudget,
} from "./RendezObserver.js";
import { flushRendezUserTurn } from "./rendez-activity.mjs";
import type { ServerSettingsService } from "./ServerSettingsService.js";

const MAX_OBSERVED_PROJECTS = 32;
// Each project needs one watch for its routes plus one per subscribed route.
const MAX_DIRECTORY_WATCHES = 1024;

export interface RendezSettings {
  enabled: boolean;
  projects: Record<string, boolean>;
  windowMs?: number;
  maxPerWindow?: number;
}

export function parseRendezSettings(value: unknown): RendezSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("rendez must be an object");
  }
  const fields = value as Record<string, unknown>;
  if (
    typeof fields.enabled !== "boolean" ||
    !fields.projects ||
    typeof fields.projects !== "object" ||
    Array.isArray(fields.projects)
  ) {
    throw new Error("rendez requires enabled and a projects map");
  }
  const projects = Object.entries(fields.projects);
  for (const [name, maximum] of [
    ["windowMs", 60000],
    ["maxPerWindow", 1000],
  ] as const) {
    const value = fields[name];
    if (
      value !== undefined &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > maximum)
    ) {
      throw new Error(`rendez.${name} must be an integer from 1 to ${maximum}`);
    }
  }
  if (
    projects.length > 128 ||
    projects.some(
      ([path, enabled]) => !isAbsolute(path) || typeof enabled !== "boolean",
    )
  ) {
    throw new Error(
      "rendez.projects requires at most 128 absolute paths with boolean overrides",
    );
  }
  return {
    enabled: fields.enabled,
    projects: Object.fromEntries(projects) as Record<string, boolean>,
    windowMs: (fields.windowMs as number | undefined) ?? 1000,
    maxPerWindow: (fields.maxPerWindow as number | undefined) ?? 10,
  };
}

export interface RendezWatchStatus {
  /** Projects whose observer is running. */
  watching: string[];
}

const MAX_REMEMBERED_USER_TURNS = 256;

/**
 * Own bounded in-process project observers. A failed observer requires a
 * settings change to retry; a project another observer already serves is
 * retried on the next check, so a restart overlap resolves itself.
 *
 * Turning a project on attaches nothing by itself: its observer, and so its
 * `.rendez` directory, waits for a user message to one of its sessions after
 * it was turned on, unless `.rendez` already exists. Trying settings out
 * therefore leaves no trace in any project.
 */
export class RendezWatchService {
  private readonly observers = new Map<
    string,
    { observer: RendezObserver; limits: string }
  >();
  private readonly started = new Set<string>();
  /** Orders turn-ons and user messages exactly; values are event sequence numbers. */
  private sequence = 0;
  /** When each explicitly configured project last turned on. */
  private readonly projectArmedAt = new Map<string, number>();
  /** When the global default last turned on, for inheriting projects. */
  private globalArmedAt: number | undefined;
  /** When each project last received an actual user message. */
  private readonly messagedAt = new Map<string, number>();
  private readonly unsubscribeUserTurns: () => void;
  private readonly failed = new Set<string>();
  private readonly conflicted = new Set<string>();
  private readonly budget: RendezWatchBudget = {
    used: 0,
    limit: MAX_DIRECTORY_WATCHES,
  };
  private readonly unsubscribe: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private work: Promise<void> = Promise.resolve();
  private scheduled = false;
  private busy = false;
  private closed = false;
  private settings: RendezSettings;

  constructor(
    settingsService: ServerSettingsService,
    private readonly listProjects: () => Promise<
      ReadonlyArray<{ path: string }>
    >,
    private readonly sessions: RendezSessions,
    userTurns: (listener: (projectPath: string) => void) => () => void,
  ) {
    this.settings = settingsService.getSetting("rendez") ?? {
      enabled: false,
      projects: {},
    };
    this.rearm({ enabled: false, projects: {} }, this.settings);
    this.unsubscribe = settingsService.onSettingsChanged(
      (settings, previous) => {
        if (settings.rendez === previous.rendez) return;
        const prior = this.settings;
        this.settings = settings.rendez ?? { enabled: false, projects: {} };
        this.rearm(prior, this.settings);
        this.failed.clear();
        this.configure();
      },
    );
    this.unsubscribeUserTurns = userTurns((projectPath) => {
      this.messagedAt.delete(projectPath);
      this.messagedAt.set(projectPath, ++this.sequence);
      if (this.messagedAt.size > MAX_REMEMBERED_USER_TURNS) {
        this.messagedAt.delete(this.messagedAt.keys().next().value as string);
      }
      if (this.isOn(projectPath) && !this.observers.has(projectPath)) {
        this.schedule();
      }
    });
    this.configure();
  }

  status(): RendezWatchStatus {
    return { watching: [...this.started].sort() };
  }

  private isOn(project: string, settings = this.settings): boolean {
    return settings.projects[project] ?? settings.enabled;
  }

  /** Record when projects turn on, so only later user messages attach them. */
  private rearm(prior: RendezSettings, next: RendezSettings): void {
    const now = ++this.sequence;
    if (prior.enabled !== next.enabled) {
      // Inheriting projects follow the new default from now on.
      for (const project of [...this.projectArmedAt.keys()]) {
        if (!(project in next.projects)) this.projectArmedAt.delete(project);
      }
      this.globalArmedAt = next.enabled ? now : undefined;
    }
    const explicit = new Set([
      ...Object.keys(prior.projects),
      ...Object.keys(next.projects),
    ]);
    for (const project of explicit) {
      const wasOn = this.isOn(project, prior);
      const isOn = this.isOn(project, next);
      if (!isOn) this.projectArmedAt.delete(project);
      else if (!wasOn) this.projectArmedAt.set(project, now);
    }
  }

  private async mayAttach(project: string): Promise<boolean> {
    const armedAt = this.projectArmedAt.get(project) ?? this.globalArmedAt;
    const messagedAt = this.messagedAt.get(project);
    if (
      armedAt !== undefined &&
      messagedAt !== undefined &&
      messagedAt > armedAt
    ) {
      return true;
    }
    try {
      return (await lstat(join(project, ".rendez"))).isDirectory();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return false;
      throw error;
    }
  }

  private configure(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const enabled =
      this.settings.enabled ||
      Object.values(this.settings.projects).some(Boolean);
    if (enabled && process.platform === "win32") {
      getLogger().warn(
        "Rendez monitoring needs POSIX symlinks and is unavailable on Windows",
      );
      return;
    }
    if (enabled) {
      this.timer = setInterval(() => this.schedule(), 30_000);
      this.timer.unref();
    }
    this.schedule();
  }

  private schedule(): void {
    this.scheduled = true;
    if (this.busy || this.closed) return;
    this.busy = true;
    this.work = (async () => {
      while (this.scheduled && !this.closed) {
        this.scheduled = false;
        await this.reconcile();
      }
    })()
      .catch((error) => {
        getLogger().warn(
          { error: String(error) },
          "Rendez watcher reconciliation failed",
        );
      })
      .finally(() => {
        this.busy = false;
      });
  }

  private async retire(project: string): Promise<void> {
    const entry = this.observers.get(project);
    if (!entry) return;
    this.observers.delete(project);
    this.started.delete(project);
    await entry.observer.close();
  }

  private async reconcile(): Promise<void> {
    if (this.closed) return;
    const configured = this.settings;
    const enabled =
      configured.enabled || Object.values(configured.projects).some(Boolean);
    const projects = enabled ? await this.listProjects() : [];
    if (this.closed || configured !== this.settings) return;
    const wanted = new Set<string>();
    const windowMs = configured.windowMs ?? 1000;
    const maxPerWindow = configured.maxPerWindow ?? 10;
    const limits = `${windowMs}:${maxPerWindow}`;
    for (const project of projects) {
      if (!this.isOn(project.path, configured)) continue;
      if (
        !this.observers.has(project.path) &&
        !(await this.mayAttach(project.path))
      ) {
        continue;
      }
      if (this.closed || configured !== this.settings) return;
      wanted.add(project.path);
      if (wanted.size === MAX_OBSERVED_PROJECTS) break;
    }
    for (const [project, entry] of this.observers) {
      if (wanted.has(project) && entry.limits === limits) {
        // Pick up subscriptions whose route events were missed.
        await entry.observer.rescanRoutes();
        continue;
      }
      await this.retire(project);
    }
    for (const project of wanted) {
      if (this.closed) return;
      if (this.observers.has(project) || this.failed.has(project)) continue;
      const observer = new RendezObserver(project, {
        windowMs,
        maxPerWindow,
        sessions: this.sessions,
        budget: this.budget,
        onFailure: (error) => {
          this.failed.add(project);
          getLogger().warn(
            { projectPath: project, error: String(error) },
            "Rendez watcher stopped; change its setting to retry",
          );
          void this.retire(project);
        },
      });
      this.observers.set(project, { observer, limits });
      try {
        await observer.start();
        this.started.add(project);
        this.conflicted.delete(project);
        flushRendezUserTurn(project);
      } catch (error) {
        await this.retire(project);
        if (error instanceof RendezConflictError) {
          if (!this.conflicted.has(project)) {
            this.conflicted.add(project);
            getLogger().warn(
              { projectPath: project, error: error.message },
              "Rendez watching deferred: another observer serves this project",
            );
          }
          continue;
        }
        this.failed.add(project);
        getLogger().warn(
          { projectPath: project, error: String(error) },
          "Rendez watcher stopped; change its setting to retry",
        );
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    this.unsubscribeUserTurns();
    if (this.timer) clearInterval(this.timer);
    await this.work;
    await Promise.all(
      [...this.observers.keys()].map((project) => this.retire(project)),
    );
  }
}
