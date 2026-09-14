import { EventEmitter } from "node:events";
import { type FSWatcher, realpathSync, statSync, watch } from "node:fs";
import { sep } from "node:path";

type Listener = (event: string, filename: string | null) => void;
interface WatchEntry {
  path: string;
  recursive: boolean;
  native: FSWatcher | null;
  identity: string;
  leases: Set<DirectoryWatchLease>;
}

class DirectoryWatchLease extends EventEmitter implements FSWatcher {
  closed = false;
  persistent: boolean;

  constructor(
    readonly recursive: boolean,
    persistent: boolean,
    private readonly release: () => void,
    private readonly updateReferences: () => void,
  ) {
    super();
    this.persistent = persistent;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.release();
    this.emit("close");
  }

  ref(): this {
    this.persistent = true;
    this.updateReferences();
    return this;
  }

  unref(): this {
    this.persistent = false;
    this.updateReferences();
    return this;
  }
}

/** One native watch per canonical directory; consumers own independent leases. */
export class SharedDirectoryWatcher {
  private readonly entries = new Map<string, WatchEntry>();

  watch(
    directory: string,
    options: { recursive?: boolean; persistent?: boolean },
    listener: Listener,
  ): FSWatcher {
    const path = realpathSync(directory);
    const { dev, ino } = statSync(path);
    const identity = `${dev}:${ino}`;
    let entry = this.entries.get(path);
    if (!entry) {
      if (this.entries.size >= 1024)
        throw Object.assign(
          new Error("Shared directory watcher budget reached"),
          { code: "EMFILE" },
        );
      entry = {
        path,
        identity,
        recursive: false,
        native: null,
        leases: new Set(),
      };
      this.entries.set(path, entry);
    }
    const current = entry;
    const lease = new DirectoryWatchLease(
      options.recursive ?? false,
      options.persistent ?? true,
      () => this.release(current, lease),
      () => this.updateReferences(current),
    );
    lease.on("change", listener);
    current.leases.add(lease);
    try {
      const replacedDirectory = current.identity !== identity;
      current.identity = identity;
      this.configure(current, lease, replacedDirectory);
    } catch (error) {
      current.leases.delete(lease);
      this.fail(
        current,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
    return lease;
  }

  private configure(
    entry: WatchEntry,
    joining?: DirectoryWatchLease,
    replacedDirectory = false,
  ): void {
    const recursive = [...entry.leases].some((lease) => lease.recursive);
    if (entry.native && entry.recursive === recursive && !replacedDirectory) {
      this.updateReferences(entry);
      return;
    }
    const replaced = entry.native;
    entry.native = null;
    replaced?.close();
    entry.recursive = recursive;
    const native = watch(
      entry.path,
      { recursive, persistent: false },
      (event, filename) => {
        if (entry.native !== native) return;
        for (const lease of [...entry.leases]) {
          if (
            !lease.closed &&
            (lease.recursive || !filename || !filename.includes(sep))
          )
            lease.emit("change", event, filename);
        }
      },
    );
    entry.native = native;
    native.on("error", (error) => {
      if (entry.native === native) this.fail(entry, error);
    });
    native.on("close", () => {
      if (entry.native === native)
        this.fail(entry, new Error("Directory watcher closed unexpectedly"));
    });
    this.updateReferences(entry);
    // A new directory identity or recursive mode creates an observation gap.
    if (replaced) {
      for (const lease of [...entry.leases]) {
        if (lease !== joining && !lease.closed)
          lease.emit("change", "rename", null);
      }
    }
  }

  private release(entry: WatchEntry, lease: DirectoryWatchLease): void {
    entry.leases.delete(lease);
    if (!entry.leases.size) {
      this.entries.delete(entry.path);
      const native = entry.native;
      entry.native = null;
      native?.close();
    } else {
      try {
        this.configure(entry);
      } catch (error) {
        this.fail(
          entry,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  private updateReferences(entry: WatchEntry): void {
    if ([...entry.leases].some((lease) => lease.persistent))
      entry.native?.ref();
    else entry.native?.unref();
  }

  private fail(entry: WatchEntry, error: Error): void {
    this.entries.delete(entry.path);
    const native = entry.native;
    entry.native = null;
    native?.close();
    const leases = [...entry.leases];
    entry.leases.clear();
    for (const lease of leases) {
      lease.closed = true;
      lease.emit("error", error);
      lease.emit("close");
    }
  }
}

const directoryWatchers = new SharedDirectoryWatcher();
export const watchSharedDirectory =
  directoryWatchers.watch.bind(directoryWatchers);
