import { lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fromUrlProjectId } from "@yep-anywhere/shared";
import type {
  ProjectFileCompletionEntry,
  ProjectFileCompletionResult,
} from "@yep-anywhere/shared";
import { runGit } from "../git/gitExec.js";
import { refreshLruMap } from "../lib/lruCollections.js";
import { registerIdleSweep } from "../lib/processIdleSweep.js";
import { onProjectFileChange } from "../projects/projectFileChanges.js";
import {
  type GitMetadataPaths,
  pathFingerprint,
  readGitMetadataFingerprint,
  resolveGitMetadata,
} from "../projects/projectWorktreeSubscriptionManager.js";
import type { EventBus } from "../watcher/EventBus.js";
import { enumerateProjectFiles } from "./projectFileEnumeration.js";

const MAX_PATHS = 1_000_000;
const MAX_ACTIVE_SCANS = 2;
const REFRESH_MS = 60_000;
const UNUSED_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BUFFER = 32 * 1024 * 1024;
const MAX_RETAINED_BYTES = 128 * 1024 * 1024;
/** Accounted path storage across every project's published inventory. */
const MAX_TOTAL_RETAINED_BYTES = 256 * 1024 * 1024;
const MAX_ACTIVE_QUERIES = 8;

/** An inventory path, and whether Git's index lists it. */
export interface InventoryEntry extends ProjectFileCompletionEntry {
  tracked: boolean;
}

/**
 * One request's read of a project's retained inventory, for a caller that
 * ranks it its own way. The entries stay owned by the service.
 */
export interface InventoryView {
  entries: readonly InventoryEntry[];
  /** The inventory may still gain paths, or is known stale. */
  pending(): boolean;
  truncated: boolean;
  /**
   * The subset of `paths` that is still present and not ignored under the
   * current ignore rules, the same recheck completion applies before offering
   * a retained path.
   */
  eligible(paths: readonly string[]): Promise<Set<string>>;
  /**
   * Stream one `git ls-files` listing of this project, with whatever arguments
   * select a non-Git project's empty repository prepended.
   */
  enumerate(
    args: readonly string[],
    visit: (path: string) => boolean,
    signal: AbortSignal,
  ): Promise<void>;
}

interface Inventory {
  entries: InventoryEntry[];
  ready: Promise<void>;
  pending: boolean;
  error?: unknown;
  refreshedAt: number;
  lastUsedAt: number;
  /** Accounted bytes of the published `entries`. */
  retainedBytes: number;
  truncated: boolean;
  args: string[];
  metadata: GitMetadataPaths | null;
  fingerprint: string;
  checking?: Promise<void>;
  generation: number;
  dirty: boolean;
}

const splitPaths = (value: string) => value.split("\0").filter(Boolean);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Created inert. Only a completion request acquires a bounded inventory. */
export class ProjectFileCompletion {
  /**
   * Least recently used first. Bounded by the process-wide byte budget and by
   * last-use expiry, checked on each request and by the process idle sweep.
   */
  private readonly inventories = new Map<string, Inventory>();
  private emptyGitDirectory?: Promise<string>;
  private activeScans = 0;
  private readonly scans = new Set<Promise<void>>();
  private readonly abort = new AbortController();
  private unsubscribeFiles?: () => void;
  private unsubscribeActivity?: () => void;
  private unregisterIdleSweep?: () => void;
  private readonly queries = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dataDir: string,
    private readonly options: {
      maxPaths?: number;
      maxRetainedBytes?: number;
      maxTotalRetainedBytes?: number;
      now?: () => number;
      eventBus?: EventBus;
    } = {},
  ) {}

  query(
    project: string,
    query: string,
    recent: readonly string[],
  ): Promise<ProjectFileCompletionResult> {
    return this.withInventory(project, ["query", query, recent], (view) =>
      this.queryInventory(view, query, recent),
    );
  }

  /**
   * Run one deduplicated, slot-limited request against the project's retained
   * inventory, acquiring or refreshing it as completion does. `key` identifies
   * identical in-flight requests.
   */
  withInventory<T>(
    project: string,
    key: unknown,
    read: (view: InventoryView) => Promise<T>,
  ): Promise<T> {
    project = resolve(project);
    this.unsubscribeFiles ??= onProjectFileChange((path) =>
      this.invalidate(path),
    );
    this.unsubscribeActivity ??= this.options.eventBus?.subscribe((event) => {
      if (
        event.type === "process-state-changed" &&
        event.activity !== "in-turn"
      )
        this.invalidate(fromUrlProjectId(event.projectId));
    });
    return this.withQuery([project, key], () =>
      this.acquire(project).then((state) => read(this.view(project, state))),
    );
  }

  /**
   * Run one request in the service's shared query slots: identical in-flight
   * requests share one computation, at most eight run at once, and disposal
   * waits for them.
   */
  withQuery<T>(key: unknown, work: () => Promise<T>): Promise<T> {
    if (this.abort.signal.aborted)
      return Promise.reject(new Error("File completion disposed"));
    const queryKey = JSON.stringify(key);
    const existing = this.queries.get(queryKey);
    if (existing) return existing as Promise<T>;
    if (this.queries.size >= MAX_ACTIVE_QUERIES)
      return Promise.reject(
        new Error("File completion is busy; try again shortly"),
      );
    const pending = work().finally(() => this.queries.delete(queryKey));
    this.queries.set(queryKey, pending);
    return pending;
  }

  /**
   * Stream `git ls-files` over a directory outside any retained inventory,
   * treating it as a non-Git tree so its own `.gitignore` files still apply.
   * Nothing is retained; the caller's visitor decides when to stop.
   */
  async enumerateDirectory(
    directory: string,
    args: readonly string[],
    visit: (path: string) => boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const gitArgs = [
      `--git-dir=${await this.emptyGitDir()}`,
      `--work-tree=${directory}`,
    ];
    await enumerateProjectFiles(
      directory,
      [...gitArgs, ...args],
      visit,
      AbortSignal.any([this.abort.signal, signal]),
    );
  }

  private invalidate(project: string): void {
    const state = this.inventories.get(resolve(project));
    if (!state) return;
    state.generation++;
    state.dirty = true;
  }

  async dispose(): Promise<void> {
    this.abort.abort();
    this.unsubscribeFiles?.();
    this.unsubscribeActivity?.();
    this.unregisterIdleSweep?.();
    await Promise.allSettled([...this.scans, ...this.queries.values()]);
    this.inventories.clear();
  }

  private async acquire(project: string): Promise<Inventory> {
    const now = this.options.now?.() ?? Date.now();
    this.releaseUnused(now);
    let state = this.inventories.get(project);
    if (!state) {
      if (this.activeScans >= MAX_ACTIVE_SCANS)
        throw new Error("File completion is busy; try again shortly");
      state = {
        entries: [],
        ready: Promise.resolve(),
        pending: true,
        refreshedAt: now,
        lastUsedAt: now,
        retainedBytes: 0,
        truncated: false,
        args: [],
        metadata: null,
        fingerprint: "",
        generation: 0,
        dirty: true,
      };
      this.inventories.set(project, state);
      this.syncIdleSweep();
      // First resolve the cheap tracked-index phase. Untracked filesystem
      // enumeration continues separately, shared by subsequent requests.
      state.ready = this.refresh(project, state, true);
    } else {
      state.lastUsedAt = now;
      refreshLruMap(this.inventories, project, state);
      if (!state.pending) {
        const current = state;
        current.checking ??= this.fingerprint(project, current.metadata)
          .then((fingerprint) => {
            if (fingerprint !== current.fingerprint) this.invalidate(project);
          })
          .finally(() => {
            current.checking = undefined;
          });
        await current.checking;
      }
      this.abort.signal.throwIfAborted();
      if (
        !state.pending &&
        ((!state.error && state.dirty) ||
          now - state.refreshedAt > REFRESH_MS) &&
        this.activeScans < MAX_ACTIVE_SCANS
      )
        void this.refresh(project, state, false);
    }
    await state.ready;
    if (state.error) throw state.error;
    return state;
  }

  private releaseUnused(now: number): void {
    for (const [path, inventory] of this.inventories) {
      if (!inventory.pending && now - inventory.lastUsedAt > UNUSED_MS)
        this.inventories.delete(path);
    }
    this.syncIdleSweep();
  }

  /** Keep the idle sweep registered exactly while inventories are retained. */
  private syncIdleSweep(): void {
    if (this.inventories.size > 0 && !this.abort.signal.aborted) {
      this.unregisterIdleSweep ??= registerIdleSweep((now) =>
        this.releaseUnused(this.options.now?.() ?? now),
      );
    } else {
      this.unregisterIdleSweep?.();
      this.unregisterIdleSweep = undefined;
    }
  }

  /**
   * Release least recently used settled inventories until the published total
   * fits the process budget. In-flight scans and `keep` are never released; a
   * released project rescans on its next request.
   */
  private enforceTotalBudget(keep: Inventory): void {
    const budget =
      this.options.maxTotalRetainedBytes ?? MAX_TOTAL_RETAINED_BYTES;
    let total = 0;
    for (const inventory of this.inventories.values())
      total += inventory.retainedBytes;
    for (const [path, inventory] of this.inventories) {
      if (total <= budget) break;
      if (inventory === keep || inventory.pending) continue;
      this.inventories.delete(path);
      total -= inventory.retainedBytes;
    }
  }

  private view(project: string, state: Inventory): InventoryView {
    const entries = state.entries;
    return {
      entries,
      pending: () =>
        state.pending ||
        (!state.error && state.dirty) ||
        state.entries !== entries,
      truncated: state.truncated,
      eligible: (paths) => this.eligible(project, state, paths),
      enumerate: (args, visit, signal) =>
        enumerateProjectFiles(
          project,
          [...state.args, ...args],
          visit,
          AbortSignal.any([this.abort.signal, signal]),
        ),
    };
  }

  private async queryInventory(
    view: InventoryView,
    query: string,
    recent: readonly string[],
  ): Promise<ProjectFileCompletionResult> {
    const needle = query.toLowerCase();
    const ranks = new Map(recent.map((path, index) => [path, index]));
    const recentMatches: InventoryEntry[] = [];
    const otherMatches: InventoryEntry[] = [];
    let matched = 0;
    for (const entry of view.entries) {
      if (!entry.path.toLowerCase().includes(needle)) continue;
      matched++;
      if (ranks.has(entry.path)) recentMatches.push(entry);
      else if (otherMatches.length < 100) otherMatches.push(entry);
    }
    recentMatches.sort(
      (a, b) => (ranks.get(a.path) ?? 0) - (ranks.get(b.path) ?? 0),
    );

    const selected = [...recentMatches, ...otherMatches].slice(0, 100);
    const eligible = await view.eligible(selected.map((entry) => entry.path));
    const offered = selected.filter((entry) => eligible.has(entry.path));
    return {
      entries: offered
        .slice(0, 30)
        .map(({ path, kind }): ProjectFileCompletionEntry => ({ path, kind })),
      pending: view.pending(),
      truncated:
        view.truncated || matched > selected.length || offered.length > 30,
    };
  }

  /**
   * Cached paths are only candidates: recheck current ignore rules before
   * offering them, including tracked files matching newly written rules, and
   * drop paths that no longer exist.
   */
  private async eligible(
    project: string,
    state: Inventory,
    paths: readonly string[],
  ): Promise<Set<string>> {
    const ignored = new Set<string>();
    if (paths.length) {
      try {
        const { stdout } = await runGit(
          project,
          [...state.args, "check-ignore", "--no-index", "-z", "--stdin"],
          {
            input: `${paths.join("\0")}\0`,
            maxBuffer: MAX_BUFFER,
          },
        );
        for (const path of splitPaths(stdout)) ignored.add(path);
      } catch (error) {
        if (
          !(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === 1
          )
        )
          throw error;
      }
    }
    const present = await Promise.all(
      paths.map(async (path) => {
        if (ignored.has(path)) return false;
        try {
          await lstat(join(project, path));
          return true;
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")
          )
            return false;
          throw error;
        }
      }),
    );
    return new Set(paths.filter((_, index) => present[index]));
  }

  private refresh(
    project: string,
    state: Inventory,
    initial: boolean,
  ): Promise<void> {
    this.activeScans++;
    state.pending = true;
    state.error = undefined;
    let ready!: () => void;
    const firstPhase = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const scan = this.start(project, state, initial, ready)
      .catch((error: unknown) => {
        state.error = error;
      })
      .finally(() => {
        state.pending = false;
        state.refreshedAt = this.options.now?.() ?? Date.now();
        this.activeScans--;
        this.scans.delete(scan);
        ready();
      });
    this.scans.add(scan);
    return firstPhase;
  }

  private async start(
    project: string,
    state: Inventory,
    initial: boolean,
    ready: () => void,
  ): Promise<void> {
    const inventory = new CompletionInventory(
      this.options.maxPaths ?? MAX_PATHS,
      this.options.maxRetainedBytes ?? MAX_RETAINED_BYTES,
    );
    const generation = state.generation;
    state.metadata = await resolveGitMetadata(project);
    const before = await this.fingerprint(project, state.metadata);
    if (state.metadata) {
      await enumerateProjectFiles(
        project,
        ["ls-files", "-z", "--cached"],
        (path) => inventory.add(path, true),
        this.abort.signal,
      );
      state.args = [];
    } else {
      state.args = [
        `--git-dir=${await this.emptyGitDir()}`,
        `--work-tree=${project}`,
      ];
      await enumerateProjectFiles(
        project,
        [
          ...state.args,
          "ls-files",
          "-z",
          "--others",
          "--exclude-standard",
          "--directory",
          "--no-empty-directory",
        ],
        (path) => inventory.add(path, false),
        this.abort.signal,
      );
    }
    if (initial || inventory.truncated) this.publish(state, inventory);
    if (!inventory.truncated) {
      ready();
      await enumerateProjectFiles(
        project,
        [
          ...state.args,
          "ls-files",
          "-z",
          "--cached",
          "--ignored",
          "--exclude-standard",
        ],
        (path) => {
          inventory.remove(path);
          return true;
        },
        this.abort.signal,
      );
      await enumerateProjectFiles(
        project,
        [...state.args, "ls-files", "-z", "--others", "--exclude-standard"],
        (path) => inventory.add(path, false),
        this.abort.signal,
      );
      this.publish(state, inventory);
    }
    state.fingerprint = await this.fingerprint(project, state.metadata);
    state.dirty =
      generation !== state.generation || before !== state.fingerprint;
  }

  private async fingerprint(
    project: string,
    metadata: GitMetadataPaths | null,
  ): Promise<string> {
    return (
      await Promise.all([
        pathFingerprint(project),
        pathFingerprint(join(project, ".git")),
        pathFingerprint(join(project, ".gitignore")),
        metadata
          ? readGitMetadataFingerprint(metadata)
          : Promise.resolve("non-git"),
      ])
    ).join("\n");
  }

  private publish(state: Inventory, inventory: CompletionInventory): void {
    state.truncated = inventory.truncated;
    state.entries = [...inventory.entries.values()].sort((a, b) =>
      compare(a.path, b.path),
    );
    state.retainedBytes = inventory.retainedBytes;
    this.enforceTotalBudget(state);
  }

  private emptyGitDir(): Promise<string> {
    this.emptyGitDirectory ??= (async () => {
      const path = join(this.dataDir, "indexes", "file-completion-empty.git");
      await mkdir(path, { recursive: true });
      await runGit(this.dataDir, ["init", "--bare", "--template=", path]);
      return path;
    })();
    return this.emptyGitDirectory;
  }
}

class CompletionInventory {
  readonly entries = new Map<string, InventoryEntry>();
  truncated = false;
  private bytes = 0;

  get retainedBytes(): number {
    return this.bytes;
  }

  constructor(
    private readonly maxPaths: number,
    private readonly maxBytes: number,
  ) {}

  add(path: string, tracked: boolean): boolean {
    if (
      path.length > 4096 ||
      /\p{Cc}/u.test(path) ||
      path.split("/").includes(".git")
    )
      return true;
    if (!this.addEntry(path, tracked)) return false;
    for (
      let slash = path.indexOf("/");
      slash >= 0;
      slash = path.indexOf("/", slash + 1)
    ) {
      if (!this.addEntry(path.slice(0, slash + 1), tracked)) return false;
    }
    return true;
  }

  remove(path: string): void {
    if (this.entries.delete(path)) this.bytes -= path.length * 2 + 128;
  }

  private addEntry(path: string, tracked: boolean): boolean {
    if (this.entries.has(path)) return true;
    const bytes = path.length * 2 + 128;
    if (this.bytes + bytes > this.maxBytes) {
      this.truncated = true;
      return false;
    }
    this.entries.set(path, {
      path,
      kind: path.endsWith("/") ? "directory" : "file",
      tracked,
    });
    this.bytes += bytes;
    this.truncated =
      this.entries.size >= this.maxPaths || this.bytes >= this.maxBytes;
    return !this.truncated;
  }
}
