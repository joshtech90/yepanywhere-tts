import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { extractComputerPackage } from "../src/computer-control/native.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

let child: EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
});
afterEach(() => vi.useRealTimers());

it("reads the stdout tail after exit before resolving extraction", async () => {
  const extraction = extractComputerPackage("archive", "destination");
  child.emit("exit", 0);
  child.stdout.write('{"extracted":true}');
  child.emit("close", 0);
  await expect(extraction).resolves.toBeUndefined();
});

it("kills cancellation and joins close before rejecting", async () => {
  const controller = new AbortController();
  const reason = new Error("Cancelled extraction");
  let settled = false;
  const extraction = extractComputerPackage(
    "archive",
    "destination",
    controller.signal,
  );
  const rejected = expect(extraction).rejects.toBe(reason);
  // Attach before abort so even an immediate rejection cannot go unhandled.
  extraction.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  controller.abort(reason);
  expect(child.kill).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(settled).toBe(false);
  child.emit("close", null);
  await rejected;
});

it("does not spawn for an already cancelled extraction", async () => {
  vi.mocked(spawn).mockClear();
  const signal = AbortSignal.abort(new Error("Already cancelled"));
  await expect(
    extractComputerPackage("archive", "destination", signal),
  ).rejects.toBe(signal.reason);
  expect(spawn).not.toHaveBeenCalled();
});

it("joins close after the management deadline kills the process", async () => {
  vi.useFakeTimers();
  const extraction = extractComputerPackage("archive", "destination");
  const rejected = expect(extraction).rejects.toThrow("deadline exceeded");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(child.kill).toHaveBeenCalledOnce();
  child.emit("close", null);
  await rejected;
});

it("reports spawn failures without waiting for the management deadline", async () => {
  const extraction = extractComputerPackage("archive", "destination");
  const error = new Error("ENOENT");
  child.emit("error", error);
  child.emit("close", -1);
  await expect(extraction).rejects.toBe(error);
});

it("bounds oversized management output and waits for close", async () => {
  const extraction = extractComputerPackage("archive", "destination");
  child.stdout.write("x".repeat(65_537));
  expect(child.kill).toHaveBeenCalledOnce();
  child.emit("close", null);
  await expect(extraction).rejects.toThrow("response exceeded size limit");
});
