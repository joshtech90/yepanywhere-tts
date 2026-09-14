const BUCKET_MS = 1_000;
const BUCKET_COUNT = 60;
const NATIVE_MEASURE_LIMIT = 256;
const NATIVE_CLEAR_INTERVAL_MS = 5_000;

type UserTiming = Pick<Performance, "measure" | "clearMeasures" | "now">;

export interface DevelopmentPerformanceSnapshot {
  windowStartedAtMs: number;
  sampledAtMs: number;
  windowMs: number;
  react: { count: number; totalDurationMs: number; maxDurationMs: number };
}

let snapshot: (() => DevelopmentPerformanceSnapshot) | null = null;

export function getDevelopmentPerformanceSnapshot(): DevelopmentPerformanceSnapshot | null {
  return snapshot?.() ?? null;
}

export function installDevelopmentPerformance(
  timing: UserTiming = performance,
): () => void {
  if (snapshot) throw new Error("Development timing is already installed");
  const startedAt = timing.now();
  const counts = new Float64Array(BUCKET_COUNT);
  const durations = new Float64Array(BUCKET_COUNT);
  const maxima = new Float64Array(BUCKET_COUNT);
  let epoch = Math.floor(startedAt / BUCKET_MS);
  let count = 0;
  let totalDurationMs = 0;
  let nativeCount = 0;

  function advance(now: number): void {
    const nextEpoch = Math.floor(now / BUCKET_MS);
    const elapsed = nextEpoch - epoch;
    if (elapsed >= BUCKET_COUNT) {
      // A suspended tab catches up in constant space, without replaying ticks.
      counts.fill(0);
      durations.fill(0);
      maxima.fill(0);
      count = 0;
      totalDurationMs = 0;
    } else {
      for (let step = 1; step <= elapsed; step++) {
        const slot = (epoch + step) % BUCKET_COUNT;
        count -= counts[slot]!;
        totalDurationMs -= durations[slot]!;
        counts[slot] = durations[slot] = maxima[slot] = 0;
      }
      if (count === 0) totalDurationMs = 0;
    }
    epoch = nextEpoch;
  }

  snapshot = () => {
    const now = timing.now();
    advance(now);
    const windowStartedAtMs = Math.max(
      startedAt,
      (epoch - BUCKET_COUNT + 1) * BUCKET_MS,
    );
    let maxDurationMs = 0;
    for (const maximum of maxima)
      maxDurationMs = Math.max(maxDurationMs, maximum);
    return {
      windowStartedAtMs,
      sampledAtMs: now,
      windowMs: now - windowStartedAtMs,
      react: { count, totalDurationMs, maxDurationMs },
    };
  };

  function clearNativeMeasures(): void {
    timing.clearMeasures();
    nativeCount = 0;
  }

  const original = timing.measure;
  const descriptor = Object.getOwnPropertyDescriptor(timing, "measure");
  function measure(
    this: UserTiming,
    name: string,
    startOrOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ): PerformanceMeasure {
    const options =
      typeof startOrOptions === "object" ? startOrOptions : undefined;
    const devtools = options?.detail?.devtools;
    const isReact =
      devtools?.track === "Components ⚛" ||
      devtools?.trackGroup === "Scheduler ⚛";
    // React's changed-prop detail can exhaust Chrome during structured cloning.
    // Preserve native timing/return semantics, but never clone that payload.
    const entry = original.call(
      this,
      name,
      isReact
        ? {
            start: options?.start,
            end: options?.end,
            duration: options?.duration,
          }
        : startOrOptions,
      endMark,
    );
    if (isReact) {
      advance(timing.now());
      const slot = epoch % BUCKET_COUNT;
      counts[slot] = counts[slot]! + 1;
      durations[slot] = durations[slot]! + entry.duration;
      maxima[slot] = Math.max(maxima[slot]!, entry.duration);
      count += 1;
      totalDurationMs += entry.duration;
    }
    if (++nativeCount >= NATIVE_MEASURE_LIMIT) clearNativeMeasures();
    return entry;
  }

  Object.defineProperty(timing, "measure", {
    configurable: true,
    writable: true,
    value: measure,
  });
  clearNativeMeasures();
  const timer = setInterval(clearNativeMeasures, NATIVE_CLEAR_INTERVAL_MS);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (timing.measure === measure) {
      if (descriptor) Object.defineProperty(timing, "measure", descriptor);
      else Reflect.deleteProperty(timing, "measure");
    }
    snapshot = null;
  };
}
