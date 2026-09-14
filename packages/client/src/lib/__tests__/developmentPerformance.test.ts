import { performance as nativePerformance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import {
  getDevelopmentPerformanceSnapshot,
  installDevelopmentPerformance,
} from "../developmentPerformance";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  nativePerformance.clearMeasures();
  vi.useRealTimers();
});

it("subtracts expired buckets and catches up after an hour without timers", () => {
  let now = 0;
  const timing = {
    now: () => now,
    measure: nativePerformance.measure.bind(nativePerformance),
    clearMeasures: nativePerformance.clearMeasures.bind(nativePerformance),
  };
  stop = installDevelopmentPerformance(timing);
  const detail = { devtools: { trackGroup: "Scheduler ⚛" } };
  timing.measure("Render", { start: 0, end: 10, detail });
  now = 1_000;
  timing.measure("Commit", { start: 0, end: 2, detail });
  now = 59_999;
  expect(getDevelopmentPerformanceSnapshot()?.react).toEqual({
    count: 2,
    totalDurationMs: 12,
    maxDurationMs: 10,
  });
  now = 60_000;
  expect(getDevelopmentPerformanceSnapshot()).toEqual({
    windowStartedAtMs: 1_000,
    sampledAtMs: 60_000,
    windowMs: 59_000,
    react: { count: 1, totalDurationMs: 2, maxDurationMs: 2 },
  });
  now = 3_600_000;
  expect(getDevelopmentPerformanceSnapshot()?.react).toEqual({
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
  });
  timing.measure("Render", { start: 0, end: 4, detail });
  expect(getDevelopmentPerformanceSnapshot()?.react).toEqual({
    count: 1,
    totalDurationMs: 4,
    maxDurationMs: 4,
  });
});

it("preserves other User Timing calls, marks, errors, and the original method", () => {
  vi.useFakeTimers();
  const original = nativePerformance.measure;
  const descriptor = Object.getOwnPropertyDescriptor(
    nativePerformance,
    "measure",
  );
  stop = installDevelopmentPerformance(nativePerformance);
  nativePerformance.mark("app-start");
  const entry = nativePerformance.measure("app", {
    start: "app-start",
    detail: { app: "payload" },
  });
  expect(entry.detail).toEqual({ app: "payload" });
  expect(entry.entryType).toBe("measure");
  expect(() => nativePerformance.measure("invalid", "missing-mark")).toThrow();
  expect(getDevelopmentPerformanceSnapshot()?.react.count).toBe(0);
  vi.advanceTimersByTime(5_000);
  expect(nativePerformance.getEntriesByType("measure")).toEqual([]);
  expect(nativePerformance.getEntriesByName("app-start", "mark")).toHaveLength(
    1,
  );
  nativePerformance.clearMarks("app-start");
  stop();
  expect(nativePerformance.measure).toBe(original);
  expect(Object.getOwnPropertyDescriptor(nativePerformance, "measure")).toEqual(
    descriptor,
  );
  expect(getDevelopmentPerformanceSnapshot()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds native development measurements without cloning React props", () => {
  stop = installDevelopmentPerformance(nativePerformance);
  const options = {
    start: 1,
    end: 3,
    detail: {
      devtools: {
        track: "Components ⚛",
        // This would throw DataCloneError if it reached native User Timing.
        properties: [() => "component state"],
      },
    },
  };
  for (let i = 0; i < 10_000; i++) {
    const entry = nativePerformance.measure("Component", options);
    expect(entry.name).toBe("Component");
    expect(entry.duration).toBe(2);
    expect(entry.detail).toBeNull();
  }
  expect(nativePerformance.getEntriesByType("measure").length).toBeLessThan(
    256,
  );
  expect(getDevelopmentPerformanceSnapshot()).toMatchObject({
    react: { count: 10_000, totalDurationMs: 20_000, maxDurationMs: 2 },
  });
});
