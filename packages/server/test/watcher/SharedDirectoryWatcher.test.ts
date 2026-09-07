import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { SharedDirectoryWatcher } from "../../src/watcher/SharedDirectoryWatcher.js";

const native = vi.hoisted(() => ({ watch: vi.fn(), ino: 1 }));
vi.mock("node:fs", async () => ({
  ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
  realpathSync: (path: string) => (path === "/alias" ? "/project" : path),
  statSync: () => ({ dev: 1, ino: native.ino }),
  watch: native.watch,
}));

class NativeWatch extends EventEmitter {
  close = vi.fn(() => this.emit("close"));
  ref = vi.fn(() => this);
  unref = vi.fn(() => this);
}

afterEach(() => {
  vi.resetAllMocks();
  native.ino = 1;
});

it("shares one canonical directory watch and closes it only after the last lease", () => {
  const watcher = new NativeWatch();
  native.watch.mockImplementation((_path, _options, listener) => {
    watcher.on("change", listener);
    return watcher;
  });
  const registry = new SharedDirectoryWatcher();
  const a = vi.fn();
  const b = vi.fn();
  const first = registry.watch("/project", { persistent: false }, a);
  const second = registry.watch("/alias", { persistent: false }, b);
  expect(native.watch).toHaveBeenCalledTimes(1);
  watcher.emit("change", "rename", "new.txt");
  expect(a).toHaveBeenCalledWith("rename", "new.txt");
  expect(b).toHaveBeenCalledWith("rename", "new.txt");
  first.close();
  expect(watcher.close).not.toHaveBeenCalled();
  watcher.emit("change", "change", "new.txt");
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(2);
  second.close();
  second.close();
  expect(watcher.close).toHaveBeenCalledTimes(1);
});

it("changes recursive coverage without overlapping native watches and invalidates the observation gap", () => {
  const watches: NativeWatch[] = [];
  let live = 0;
  native.watch.mockImplementation((_path, _options, listener) => {
    expect(live).toBe(0);
    live++;
    const watcher = new NativeWatch();
    watcher.on("change", listener);
    watcher.on("close", () => live--);
    watches.push(watcher);
    return watcher;
  });
  const registry = new SharedDirectoryWatcher();
  const flat = vi.fn();
  const deep = vi.fn();
  const first = registry.watch("/project", {}, flat);
  const second = registry.watch("/project", { recursive: true }, deep);
  expect(flat).toHaveBeenCalledWith("rename", null);
  watches[1]?.emit("change", "rename", "nested/file");
  expect(deep).toHaveBeenCalledWith("rename", "nested/file");
  expect(flat).toHaveBeenCalledTimes(1);
  second.close();
  expect(native.watch).toHaveBeenCalledTimes(3);
  first.close();
  expect(live).toBe(0);
});

it("fans native failures out to all leases and permits a fresh shared watch", () => {
  const watches: NativeWatch[] = [];
  native.watch.mockImplementation(() => {
    const watcher = new NativeWatch();
    watches.push(watcher);
    return watcher;
  });
  const registry = new SharedDirectoryWatcher();
  const errors = [vi.fn(), vi.fn()];
  const first = registry.watch("/project", {}, vi.fn()).on("error", errors[0]!);
  const second = registry
    .watch("/project", {}, vi.fn())
    .on("error", errors[1]!);
  const failure = new Error("watch lost");
  watches[0]?.emit("error", failure);
  for (const listener of errors) expect(listener).toHaveBeenCalledWith(failure);
  const next = registry.watch("/project", {}, vi.fn());
  first.close();
  second.close();
  expect(watches[1]?.close).not.toHaveBeenCalled();
  next.close();
});

it("replaces an old directory inode before sharing a newly acquired lease", () => {
  const watches: NativeWatch[] = [];
  native.watch.mockImplementation(() => {
    const watcher = new NativeWatch();
    watches.push(watcher);
    return watcher;
  });
  const registry = new SharedDirectoryWatcher();
  const changed = vi.fn();
  const first = registry.watch("/project", {}, changed);
  native.ino = 2;
  const second = registry.watch("/project", {}, vi.fn());
  expect(watches[0]?.close).toHaveBeenCalledTimes(1);
  expect(native.watch).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenCalledWith("rename", null);
  first.close();
  second.close();
});
