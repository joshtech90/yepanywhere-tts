import { stat } from "node:fs/promises";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { getLogger } from "./logger.js";

/**
 * Periodic process-resource line for a server that is *currently* impaired.
 * The 2026-08-04 heap-exhaustion incident and the recurring "server stopped
 * answering, restart fixed it" reports both left no in-process evidence,
 * because nothing recorded memory, CPU, or scheduling delay while the trouble
 * was happening. One bounded log line per interval survives the crash or
 * restart that a query-time metrics route cannot.
 *
 * See topics/server-performance-observability.md § Server metrics.
 */

const DEFAULT_INTERVAL_SECONDS = 60;
/** perf_hooks reports event-loop delay in nanoseconds. */
const NS_PER_MS = 1e6;

export interface ResourceSample {
  event: "server_resource_sample";
  uptimeSeconds: number;
  /** Share of one core used by this process since the previous sample. */
  cpuPercent: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  heapLimitMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  /** Longest single event-loop stall observed since the previous sample. */
  loopDelayMaxMs: number;
  loopDelayP99Ms: number;
  loopDelayMeanMs: number;
  /**
   * One `stat` of the data directory. A slow value with a healthy loop delay
   * points at filesystem or libuv threadpool saturation rather than at
   * JavaScript work; the default data directory is often on network storage.
   */
  dataDirStatMs: number;
  sampleIntervalMs: number;
}

const megabytes = (bytes: number): number =>
  Math.round((bytes / 1024 / 1024) * 10) / 10;

const milliseconds = (nanoseconds: number): number =>
  Math.round(nanoseconds / NS_PER_MS);

export interface ResourceSamplerOptions {
  dataDir: string;
  intervalMs?: number;
  onSample?: (sample: ResourceSample) => void;
}

/**
 * Reads `YEP_RESOURCE_SAMPLE_SECONDS`; 0 disables sampling entirely.
 */
export function resourceSampleIntervalMs(
  value: string | undefined = process.env.YEP_RESOURCE_SAMPLE_SECONDS,
): number {
  if (value === undefined || value === "")
    return DEFAULT_INTERVAL_SECONDS * 1000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      "YEP_RESOURCE_SAMPLE_SECONDS must be a non-negative number of seconds",
    );
  }
  return Math.round(seconds * 1000);
}

/**
 * Starts periodic sampling and returns the stop function. The interval is
 * unreferenced, so sampling never keeps the process alive by itself.
 */
export function startResourceSampling(
  options: ResourceSamplerOptions,
): () => void {
  const intervalMs = options.intervalMs ?? resourceSampleIntervalMs();
  if (intervalMs <= 0) return () => {};

  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  let previousCpu = process.cpuUsage();
  let previousAt = Date.now();

  const sample = async (): Promise<void> => {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - previousAt);
    const cpu = process.cpuUsage(previousCpu);
    previousCpu = process.cpuUsage();
    previousAt = now;

    const statStart = process.hrtime.bigint();
    try {
      await stat(options.dataDir);
    } catch {
      // A missing or unreachable data directory is itself worth timing; the
      // failure is already visible to every service that needs to read it.
    }
    const statMs = Number(process.hrtime.bigint() - statStart) / NS_PER_MS;

    const memory = process.memoryUsage();
    const heap = getHeapStatistics();
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const record: ResourceSample = {
      event: "server_resource_sample",
      uptimeSeconds: Math.round(process.uptime()),
      cpuPercent: Math.round((cpuMs / elapsedMs) * 1000) / 10,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      rssMb: megabytes(memory.rss),
      heapUsedMb: megabytes(memory.heapUsed),
      heapTotalMb: megabytes(memory.heapTotal),
      heapLimitMb: megabytes(heap.heap_size_limit),
      externalMb: megabytes(memory.external),
      arrayBuffersMb: megabytes(memory.arrayBuffers),
      loopDelayMaxMs: milliseconds(histogram.max),
      loopDelayP99Ms: milliseconds(histogram.percentile(99)),
      loopDelayMeanMs: milliseconds(histogram.mean),
      dataDirStatMs: Math.round(statMs * 10) / 10,
      sampleIntervalMs: elapsedMs,
    };
    histogram.reset();

    getLogger().info(
      record,
      `RESOURCE: rss ${record.rssMb}MB, heap ${record.heapUsedMb}/${record.heapLimitMb}MB, ` +
        `cpu ${record.cpuPercent}%, loop delay max ${record.loopDelayMaxMs}ms, ` +
        `data dir stat ${record.dataDirStatMs}ms`,
    );
    options.onSample?.(record);
  };

  const timer = setInterval(() => {
    void sample();
  }, intervalMs);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
