// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { acquireStreamingCaptureContext } from "../speechProviders/streamingCaptureContext";

function fakeContextClass() {
  const instances: FakeContext[] = [];
  class FakeContext {
    state: AudioContextState = "running";
    close = vi.fn(async () => {
      this.state = "closed";
    });
    suspend = vi.fn(async () => {
      this.state = "suspended";
    });
    constructor() {
      instances.push(this);
    }
  }
  return {
    Ctor: FakeContext as unknown as typeof AudioContext,
    instances,
  };
}

describe("streaming capture context leases", () => {
  it("reuses one context across dictations and suspends it only when idle", () => {
    const { Ctor, instances } = fakeContextClass();
    const first = acquireStreamingCaptureContext(Ctor, 16_000, { reuse: true });
    const overlapping = acquireStreamingCaptureContext(Ctor, 16_000, {
      reuse: true,
    });
    expect(overlapping.context).toBe(first.context);
    expect(instances).toHaveLength(1);

    first.release();
    first.release();
    expect(instances[0]?.suspend).not.toHaveBeenCalled();
    overlapping.release();
    expect(instances[0]?.suspend).toHaveBeenCalledTimes(1);
    expect(instances[0]?.close).not.toHaveBeenCalled();

    const next = acquireStreamingCaptureContext(Ctor, 16_000, { reuse: true });
    expect(next.context).toBe(first.context);
    next.release();
  });

  it("gives each dictation a private context when reuse is off", () => {
    const { Ctor, instances } = fakeContextClass();
    const lease = acquireStreamingCaptureContext(Ctor, 16_000, {
      reuse: false,
    });
    lease.release();
    lease.release();
    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
    const again = acquireStreamingCaptureContext(Ctor, 16_000, {
      reuse: false,
    });
    expect(again.context).not.toBe(lease.context);
    again.release();
  });

  it("replaces a closed shared context", () => {
    const { Ctor, instances } = fakeContextClass();
    const lease = acquireStreamingCaptureContext(Ctor, 16_000, { reuse: true });
    lease.release();
    if (instances[0]) instances[0].state = "closed";
    const next = acquireStreamingCaptureContext(Ctor, 16_000, { reuse: true });
    expect(next.context).not.toBe(lease.context);
    next.release();
  });
});
