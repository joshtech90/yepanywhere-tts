import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startStallRecording } from "../../src/logging/stall-recording.js";

const logger = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../../src/logging/logger.js", () => ({ getLogger: () => logger }));
beforeEach(() => logger.warn.mockClear());

function blockEventLoopForTest() {
  const until = performance.now() + 180;
  while (performance.now() < until) {
    // Deliberately block only this test worker, never the shared YA server.
  }
}

describe("stall recording", () => {
  it("caps retained profiles at three files across repeated stalls", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ya-stall-recording-"));
    const stop = await startStallRecording({
      dataDir,
      windowMs: 100,
      thresholdMs: 50,
    });
    try {
      for (let capture = 1; capture <= 4; capture += 1) {
        await delay(25);
        blockEventLoopForTest();
        await vi.waitFor(() => {
          expect(
            logger.warn.mock.calls.filter(
              ([record]) => record.event === "server_stall_profile",
            ),
          ).toHaveLength(capture);
        });
      }
      await stop();
      expect((await readdir(join(dataDir, "logs", "stalls"))).sort()).toEqual([
        "event-loop-stall-0.cpuprofile",
        "event-loop-stall-1.cpuprofile",
        "event-loop-stall-2.cpuprofile",
      ]);
    } finally {
      await stop();
      await rm(dataDir, { recursive: true });
    }
  });

  it("logs and skips a profile above the byte ceiling", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ya-stall-recording-"));
    const stop = await startStallRecording({
      dataDir,
      windowMs: 100,
      thresholdMs: 50,
      maxProfileBytes: 1,
    });
    try {
      await delay(25);
      blockEventLoopForTest();
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ event: "server_stall_profile_too_large" }),
          expect.any(String),
        );
      });
      expect(await readdir(dataDir)).toEqual([]);
    } finally {
      await stop();
      await rm(dataDir, { recursive: true });
    }
  });

  it("retains a blocking stack and stops writing after shutdown", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ya-stall-recording-"));
    const stop = await startStallRecording({
      dataDir,
      windowMs: 100,
      thresholdMs: 50,
      samplingIntervalUs: 1_000,
    });
    try {
      await delay(25);
      // A timer entry stays identifiable when V8 inlines the busy-loop helper.
      await new Promise<void>((resolve) => {
        setImmediate(function recordedStallFixture() {
          blockEventLoopForTest();
          resolve();
        });
      });
      const directory = join(dataDir, "logs", "stalls");
      await vi.waitFor(async () => {
        expect(await readdir(directory)).toContain(
          "event-loop-stall-0.cpuprofile",
        );
      });
      await stop();
      const contents = await readFile(
        join(directory, "event-loop-stall-0.cpuprofile"),
        "utf8",
      );
      const profile = JSON.parse(contents);
      expect(profile.yepStall.loopDelayMaxMs).toBeGreaterThanOrEqual(50);
      expect(JSON.stringify(profile.nodes)).toContain("recordedStallFixture");
      blockEventLoopForTest();
      await delay(150);
      expect(await readdir(directory)).toEqual([
        "event-loop-stall-0.cpuprofile",
      ]);
    } finally {
      await stop();
      await rm(dataDir, { recursive: true });
    }
  });

  it("writes no profile when the window does not exceed the threshold", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "ya-stall-recording-"));
    const stop = await startStallRecording({
      dataDir,
      windowMs: 30,
      thresholdMs: 60_000,
    });
    try {
      await delay(100);
      await stop();
      expect(await readdir(dataDir)).toEqual([]);
    } finally {
      await stop();
      await rm(dataDir, { recursive: true });
    }
  });
});
