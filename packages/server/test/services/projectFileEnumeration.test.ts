import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { enumerateProjectFiles } from "../../src/services/projectFileEnumeration.js";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => ({
  ...(await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  )),
  spawn,
}));

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawn.mockReturnValue(child);
  return child;
}

afterEach(() => vi.resetAllMocks());

it("kills enumeration immediately at the consumer limit and waits for child close", async () => {
  const child = childProcess();
  const paths: string[] = [];
  const task = enumerateProjectFiles("/project", ["ls-files", "-z"], (path) => {
    paths.push(path);
    return paths.length < 2;
  });
  let settled = false;
  void task.then(() => {
    settled = true;
  });
  child.stdout.write("one\0two\0three\0");
  child.stdout.write("more\0");
  expect(paths).toEqual(["one", "two"]);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  await Promise.resolve();
  expect(settled).toBe(false);
  child.emit("close", null, "SIGKILL");
  await task;
  expect(spawn).toHaveBeenCalledWith(
    "git",
    ["--no-optional-locks", "-C", "/project", "ls-files", "-z"],
    expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
  );
});

it("decodes split UTF-8 records and skips oversized records without accumulating them", async () => {
  const child = childProcess();
  const paths: string[] = [];
  const task = enumerateProjectFiles("/project", [], (path) => {
    paths.push(path);
    return true;
  });
  const unicode = Buffer.from("雪.txt\0");
  child.stdout.write(unicode.subarray(0, 2));
  child.stdout.write(unicode.subarray(2));
  for (let i = 0; i < 8; i++) child.stdout.write(Buffer.alloc(4096, 97));
  child.stdout.write("\0next\0");
  child.emit("close", 0, null);
  await task;
  expect(paths).toEqual(["雪.txt", "next"]);
});

it("fails rather than treating abort or incomplete output as a complete inventory", async () => {
  const child = childProcess();
  const controller = new AbortController();
  const task = enumerateProjectFiles(
    "/project",
    [],
    () => true,
    controller.signal,
  );
  controller.abort();
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  child.emit("close", null, "SIGKILL");
  await expect(task).rejects.toThrow("aborted");

  const next = childProcess();
  const incomplete = enumerateProjectFiles("/project", [], () => true);
  next.stdout.write("unterminated");
  next.emit("close", 0, null);
  await expect(incomplete).rejects.toThrow("incomplete path");
});
