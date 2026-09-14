import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  resourceSampleIntervalMs,
  startResourceSampling,
  type ResourceSample,
} from "../../src/logging/resource-sample.js";

describe("resource sample interval", () => {
  it("defaults to one minute and accepts an explicit period", () => {
    expect(resourceSampleIntervalMs(undefined)).toBe(60_000);
    expect(resourceSampleIntervalMs("")).toBe(60_000);
    expect(resourceSampleIntervalMs("5")).toBe(5_000);
    expect(resourceSampleIntervalMs("0.5")).toBe(500);
  });

  it("treats zero as off and rejects unusable values", () => {
    expect(resourceSampleIntervalMs("0")).toBe(0);
    expect(() => resourceSampleIntervalMs("-1")).toThrow(
      /non-negative number of seconds/,
    );
    expect(() => resourceSampleIntervalMs("often")).toThrow(
      /non-negative number of seconds/,
    );
  });
});

describe("resource sampling", () => {
  it("reports memory, scheduling delay, and data-directory latency", async () => {
    const samples: ResourceSample[] = [];
    const sampled = new Promise<void>((resolve) => {
      const stop = startResourceSampling({
        dataDir: tmpdir(),
        intervalMs: 10,
        onSample: (sample) => {
          samples.push(sample);
          if (samples.length === 1) {
            stop();
            resolve();
          }
        },
      });
    });
    await sampled;

    const sample = samples[0];
    expect(sample).toBeDefined();
    expect(sample?.event).toBe("server_resource_sample");
    expect(sample?.rssMb).toBeGreaterThan(0);
    expect(sample?.heapLimitMb).toBeGreaterThan(sample?.heapUsedMb ?? 0);
    expect(sample?.loopDelayMaxMs).toBeGreaterThanOrEqual(0);
    expect(sample?.dataDirStatMs).toBeGreaterThanOrEqual(0);
    expect(sample?.cpuPercent).toBeGreaterThanOrEqual(0);
  });

  it("stops sampling and never samples when the period is zero", async () => {
    const samples: ResourceSample[] = [];
    const stop = startResourceSampling({
      dataDir: tmpdir(),
      intervalMs: 0,
      onSample: (sample) => samples.push(sample),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    expect(samples).toHaveLength(0);
  });
});
