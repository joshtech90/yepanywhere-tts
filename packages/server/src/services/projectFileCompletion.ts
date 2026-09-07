import { lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fromUrlProjectId } from "@yep-anywhere/shared";
import type {
  ProjectFileCompletionEntry,
  ProjectFileCompletionResult,
} from "@yep-anywhere/shared";
import { runGit } from "../git/gitExec.js";
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
const MAX_ACTIVE_QUERIES = 8;

interface Inventory {
  entries: ProjectFileCompletionEntry[];
  ready: Promise<void>;
  pending: boolean;
  error?: unknown;
  refreshedAt: number;
  lastUsedAt: number;
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
  private readonly inventories = new Map<string, Inventory>();
  private emptyGitDirectory?: Promise<string>;
  private activeScans = 0;
  private readonly scans = new Set<Promise<void>>();
  private readonly abort = new AbortController();
  private unsubscribeFiles?: () => void;
  private unsubscribeActivity?: () => void;
  private readonly queries = new Map<
    string,
    Promise<ProjectFileCompletionResult>
  >();

  constructor(
    private readonly dataDir: string,
    private readonly options: {
      maxPaths?: number;
      maxRetainedBytes?: number;
      now?: () => number;
      eventBus?: EventBus;
    } = {},
  ) {}

  query(
    project: string,
    query: string,
    recent: readonly string[],
  ): Promise<ProjectFileCompletionResult> {
    if (this.abort.signal.aborted)
      return Promise.reject(new Error("File completion disposed"));
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
    const key = JSON.stringify([project, query, recent]);
    const existing = this.queries.get(key);
    if (existing) return existing;
    if (this.queries.size >= MAX_ACTIVE_QUERIES)
      return Promise.reject(
        new Error("File completion is busy; try again shortly"),
      );
    const pending = this.queryInventory(project, query, recent).finally(() =>
      this.queries.delete(key),
    );
    this.queries.set(key, pending);
    return pending;
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
    await Promise.allSettled([...this.scans, ...this.queries.values()]);
    this.inventories.clear();
  }

  private async queryInventory(
    project: string,
    query: string,
    recent: readonly string[],
  ): Promise<ProjectFileCompletionResult> {
    const now = this.options.now?.() ?? Date.now();
    for (const [path, inventory] of this.inventories) {
      if (!inventory.pending && now - inventory.lastUsedAt > UNUSED_MS)
        this.inventories.delete(path);
    }
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
        truncated: false,
        args: [],
        metadata: null,
        fingerprint: "",
        generation: 0,
        dirty: true,
      };
      this.inventories.set(project, state);
      // First resolve the cheap tracked-index phase. Untracked filesystem
      // enumeration continues separately, shared by subsequent requests.
      state.ready = this.refresh(project, state, true);
    } else {
      state.lastUsedAt = now;
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
    const needle = query.toLowerCase();
    const ranks = new Map(recent.map((path, index) => [path, index]));
    const inventoryEntries = state.entries;
    const recentMatches: ProjectFileCompletionEntry[] = [];
    const otherMatches: ProjectFileCompletionEntry[] = [];
    let matched = 0;
    for (const entry of inventoryEntries) {
      if (!entry.path.toLowerCase().includes(needle)) continue;
      matched++;
      if (ranks.has(entry.path)) recentMatches.push(entry);
      else if (otherMatches.length < 100) otherMatches.push(entry);
    }
    recentMatches.sort(
      (a, b) => (ranks.get(a.path) ?? 0) - (ranks.get(b.path) ?? 0),
    );

    // Cached paths are only candidates: recheck current ignore rules before
    // offering them, including tracked files matching newly written rules.
    const selected = [...recentMatches, ...otherMatches].slice(0, 100);
    const ignored = new Set<string>();
    if (selected.length) {
      try {
        const { stdout } = await runGit(
          project,
          [...state.args, "check-ignore", "--no-index", "-z", "--stdin"],
          {
            input: `${selected.map((entry) => entry.path).join("\0")}\0`,
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
      selected.map(async (entry) => {
        if (ignored.has(entry.path)) return false;
        try {
          await lstat(join(project, entry.path));
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
    const eligible = selected.filter((_, index) => present[index]);
    return {
      entries: eligible.slice(0, 30),
      pending:
        state.pending ||
        (!state.error && state.dirty) ||
        state.entries !== inventoryEntries,
      truncated:
        state.truncated || matched > selected.length || eligible.length > 30,
    };
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
        (path) => inventory.add(path),
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
        (path) => inventory.add(path),
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
        (path) => inventory.add(path),
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
  readonly entries = new Map<string, ProjectFileCompletionEntry>();
  truncated = false;
  private bytes = 0;

  constructor(
    private readonly maxPaths: number,
    private readonly maxBytes: number,
  ) {}

  add(path: string): boolean {
    if (
      path.length > 4096 ||
      /\p{Cc}/u.test(path) ||
      path.split("/").includes(".git")
    )
      return true;
    if (!this.addEntry(path)) return false;
    for (
      let slash = path.indexOf("/");
      slash >= 0;
      slash = path.indexOf("/", slash + 1)
    ) {
      if (!this.addEntry(path.slice(0, slash + 1))) return false;
    }
    return true;
  }

  remove(path: string): void {
    if (this.entries.delete(path)) this.bytes -= path.length * 2 + 128;
  }

  private addEntry(path: string): boolean {
    if (this.entries.has(path)) return true;
    const bytes = path.length * 2 + 128;
    if (this.bytes + bytes > this.maxBytes) {
      this.truncated = true;
      return false;
    }
    this.entries.set(path, {
      path,
      kind: path.endsWith("/") ? "directory" : "file",
    });
    this.bytes += bytes;
    this.truncated =
      this.entries.size >= this.maxPaths || this.bytes >= this.maxBytes;
    return !this.truncated;
  }
}
