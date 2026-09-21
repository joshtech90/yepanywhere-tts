import { describe, expect, it } from "vitest";
import { createStreamDispatchCoalescer } from "../streamDispatchCoalescer";

function createClock() {
  let now = 1_000;
  let nextId = 1;
  let timers: Array<{ id: number; at: number; callback: () => void }> = [];
  const runDue = (target: number) => {
    for (;;) {
      const due = timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((timer) => timer.id !== due.id);
      now = Math.max(now, due.at);
      due.callback();
    }
  };
  return {
    /** Advance time, running timers as they come due. */
    advance(ms: number) {
      const target = now + ms;
      runDue(target);
      now = target;
    },
    /** Jump time without running timers (a busy main thread), then run them. */
    stall(ms: number) {
      now += ms;
      runDue(now);
    },
    get pendingTimers() {
      return timers.length;
    },
    options: {
      now: () => now,
      setTimer: (callback: () => void, delayMs: number) => {
        const id = nextId++;
        timers.push({ id, at: now + delayMs, callback });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers = timers.filter((timer) => timer.id !== handle);
      },
    },
  };
}

describe("createStreamDispatchCoalescer", () => {
  it("dispatches immediately when the stream is quiet", () => {
    const clock = createClock();
    const seen: number[] = [];
    const coalescer = createStreamDispatchCoalescer<number>(
      (event) => seen.push(event),
      { minGapMs: 32, ...clock.options },
    );
    coalescer.dispatch(1);
    expect(seen).toEqual([1]);
    clock.advance(40);
    coalescer.dispatch(2);
    expect(seen).toEqual([1, 2]);
    expect(coalescer.queuedCount).toBe(0);
  });

  it("queues events inside the gap and flushes them in order at the gap end", () => {
    const clock = createClock();
    const seen: Array<{ event: number; at: number }> = [];
    const coalescer = createStreamDispatchCoalescer<number>(
      (event) => seen.push({ event, at: clock.options.now() }),
      { minGapMs: 32, ...clock.options },
    );
    coalescer.dispatch(1);
    clock.advance(5);
    coalescer.dispatch(2);
    coalescer.dispatch(3);
    clock.advance(5);
    coalescer.dispatch(4);
    expect(seen.map((entry) => entry.event)).toEqual([1]);
    expect(coalescer.queuedCount).toBe(3);
    clock.advance(30);
    expect(seen).toEqual([
      { event: 1, at: 1_000 },
      { event: 2, at: 1_032 },
      { event: 3, at: 1_032 },
      { event: 4, at: 1_032 },
    ]);
    expect(coalescer.queuedCount).toBe(0);
    expect(clock.pendingTimers).toBe(0);
  });

  it("widens the gap while flushes run late and narrows it when on time", () => {
    const clock = createClock();
    const coalescer = createStreamDispatchCoalescer<number>(() => {}, {
      minGapMs: 32,
      maxGapMs: 400,
      ...clock.options,
    });
    coalescer.dispatch(1);
    clock.advance(1);
    coalescer.dispatch(2);
    clock.stall(120); // due at +32, fired 89 ms late
    expect(coalescer.gapMs).toBe(64);
    coalescer.dispatch(3);
    clock.stall(200);
    expect(coalescer.gapMs).toBe(128);
    coalescer.dispatch(4);
    clock.advance(128); // on time
    expect(coalescer.gapMs).toBe(96);
    coalescer.dispatch(5);
    clock.stall(5_000);
    expect(coalescer.gapMs).toBe(192);
    coalescer.dispatch(6);
    clock.stall(5_000);
    expect(coalescer.gapMs).toBe(384);
    coalescer.dispatch(7);
    clock.stall(5_000);
    expect(coalescer.gapMs).toBe(400);
  });

  it("flush drains the queue now and dispose drops it", () => {
    const clock = createClock();
    const seen: number[] = [];
    const coalescer = createStreamDispatchCoalescer<number>(
      (event) => seen.push(event),
      { minGapMs: 32, ...clock.options },
    );
    coalescer.dispatch(1);
    coalescer.dispatch(2);
    coalescer.flush();
    expect(seen).toEqual([1, 2]);
    expect(clock.pendingTimers).toBe(0);
    coalescer.dispatch(3);
    coalescer.dispose();
    clock.advance(100);
    expect(seen).toEqual([1, 2]);
    expect(clock.pendingTimers).toBe(0);
  });

  it("keeps a throwing dispatch from wedging later events", () => {
    const clock = createClock();
    const seen: number[] = [];
    const coalescer = createStreamDispatchCoalescer<number>(
      (event) => {
        if (event === 1) throw new Error("boom");
        seen.push(event);
      },
      { minGapMs: 32, ...clock.options },
    );
    expect(() => coalescer.dispatch(1)).toThrow("boom");
    clock.advance(40);
    coalescer.dispatch(2);
    expect(seen).toEqual([2]);
  });
});
