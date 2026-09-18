import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { getLogger } from "./logger.js";

interface StallRecordingOptions {
  dataDir: string;
  windowMs?: number;
  thresholdMs?: number;
  samplingIntervalUs?: number;
  maxProfileBytes?: number;
}

/** Retain the stacks from before a stall; profiling started afterward misses it. */
export async function startStallRecording({
  dataDir,
  windowMs = 30_000,
  thresholdMs = 1_000,
  samplingIntervalUs = 10_000,
  maxProfileBytes = 8 * 1024 * 1024,
}: StallRecordingOptions): Promise<() => Promise<void>> {
  // Bun's inspector does not implement the Node CPU-profiler contract.
  if (process.versions.bun) return async () => {};

  const { Session } = await import("node:inspector/promises");
  const session = new Session();
  try {
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", {
      interval: samplingIntervalUs,
    });
    await session.post("Profiler.start");
  } catch (error) {
    session.disconnect();
    throw error;
  }

  let stopped = false;
  let profiling = true;
  let inFlight: Promise<void> | undefined;
  let shutdown: Promise<void> | undefined;
  let slot = 0;
  let previousCpu = process.cpuUsage();
  let previousAt = Date.now();
  let lastCaptureAt = Number.NEGATIVE_INFINITY;
  const checkIntervalMs = Math.min(100, windowMs);
  let previousTickAt = performance.now();
  let maximumDelayMs = 0;

  const rotate = async () => {
    const endedAt = Date.now();
    const loopDelayMaxMs = Math.round(maximumDelayMs);
    const cpu = process.cpuUsage(previousCpu);
    const startedAt = previousAt;
    previousAt = endedAt;
    previousCpu = process.cpuUsage();
    maximumDelayMs = 0;
    const { profile } = await session.post("Profiler.stop");
    profiling = false;
    if (stopped) return;
    await session.post("Profiler.start");
    profiling = true;
    if (loopDelayMaxMs < thresholdMs) return;

    const evidence = {
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      pid: process.pid,
      nodeVersion: process.versions.node,
      loopDelayMaxMs,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
    };
    const serialized = JSON.stringify({ ...profile, yepStall: evidence });
    const bytes = Buffer.byteLength(serialized);
    if (bytes > maxProfileBytes) {
      getLogger().warn(
        { event: "server_stall_profile_too_large", ...evidence, bytes },
        "STALL: profile exceeds retention byte limit",
      );
      return;
    }

    const directory = join(dataDir, "logs", "stalls");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `event-loop-stall-${slot}.cpuprofile`);
    await writeFile(path, serialized, { mode: 0o600 });
    lastCaptureAt = endedAt;
    slot = (slot + 1) % 3;
    getLogger().warn(
      { event: "server_stall_profile", ...evidence, path, bytes },
      `STALL: ${loopDelayMaxMs}ms event-loop delay; profile saved to ${path}`,
    );
  };

  const timer = setInterval(() => {
    const tickAt = performance.now();
    maximumDelayMs = Math.max(
      maximumDelayMs,
      tickAt - previousTickAt - checkIntervalMs,
    );
    previousTickAt = tickAt;
    if (stopped || inFlight) return;
    const now = Date.now();
    const stalled = maximumDelayMs >= thresholdMs;
    if (
      now - previousAt < windowMs &&
      (!stalled || now - lastCaptureAt < windowMs)
    )
      return;
    inFlight = rotate()
      .catch((error: unknown) => {
        stopped = true;
        clearInterval(timer);
        profiling = false;
        session.disconnect();
        getLogger().warn(
          { event: "server_stall_recording_failed", err: error },
          "STALL: recording disabled after a capture failure",
        );
      })
      .finally(() => {
        inFlight = undefined;
      });
  }, checkIntervalMs);
  timer.unref();

  return () => {
    shutdown ??= (async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
      try {
        if (profiling) await session.post("Profiler.stop");
      } finally {
        session.disconnect();
      }
    })();
    return shutdown;
  };
}
