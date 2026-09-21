/**
 * Coalesces live session stream events before they reach React state.
 *
 * Every stream event used to become its own state update, so a burst — a
 * late-join replay of the last 15–30 s, or a busy turn with a large
 * transcript — produced one React commit per event. When commits fall behind
 * arrivals, React 19 counts each commit that leaves more work pending as a
 * "nested update" and, after 50 in a row, throws "Maximum update depth
 * exceeded" from the next setState. The tab freezes for the whole run-up and
 * the throw either lands in an event handler (an unhandled rejection) or in a
 * React commit, where the error boundary blanks the page.
 *
 * Rules:
 * - Quiet stream: the event is dispatched immediately, so acknowledgements
 *   and status keep their light-load latency.
 * - Within `gapMs` of the previous dispatch: the event is queued and the queue
 *   is flushed, in arrival order, in one task at the end of the gap. Whatever
 *   React work those dispatches produce then commits together.
 * - The gap adapts to main-thread pressure measured by timer lateness: a flush
 *   that fires more than one gap late doubles the gap (up to `maxGapMs`); a
 *   flush that fires on time shrinks it back toward `minGapMs`.
 */
export interface StreamDispatchCoalescerOptions {
  minGapMs?: number;
  maxGapMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface StreamDispatchCoalescer<T> {
  dispatch: (event: T) => void;
  /** Dispatches everything queued right now, in order. */
  flush: () => void;
  /** Drops queued events and cancels the pending flush. */
  dispose: () => void;
  readonly queuedCount: number;
  readonly gapMs: number;
}

export const DEFAULT_STREAM_DISPATCH_MIN_GAP_MS = 32;
export const DEFAULT_STREAM_DISPATCH_MAX_GAP_MS = 400;

export function createStreamDispatchCoalescer<T>(
  process: (event: T) => void,
  options: StreamDispatchCoalescerOptions = {},
): StreamDispatchCoalescer<T> {
  const minGapMs = options.minGapMs ?? DEFAULT_STREAM_DISPATCH_MIN_GAP_MS;
  const maxGapMs = Math.max(
    minGapMs,
    options.maxGapMs ?? DEFAULT_STREAM_DISPATCH_MAX_GAP_MS,
  );
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));

  let queue: T[] = [];
  let timer: unknown = null;
  let dueAt = 0;
  let lastDispatchAt = Number.NEGATIVE_INFINITY;
  let gapMs = minGapMs;

  const processQueued = () => {
    const batch = queue;
    queue = [];
    try {
      for (const event of batch) {
        process(event);
      }
    } finally {
      lastDispatchAt = now();
    }
  };

  const onTimer = () => {
    timer = null;
    const latenessMs = now() - dueAt;
    if (latenessMs > gapMs) {
      gapMs = Math.min(maxGapMs, gapMs * 2);
    } else if (latenessMs <= gapMs / 4) {
      gapMs = Math.max(minGapMs, Math.round(gapMs * 0.75));
    }
    processQueued();
  };

  return {
    dispatch(event) {
      const at = now();
      if (timer === null && at - lastDispatchAt >= gapMs) {
        try {
          process(event);
        } finally {
          lastDispatchAt = at;
        }
        return;
      }
      queue.push(event);
      if (timer === null) {
        dueAt = lastDispatchAt + gapMs;
        timer = setTimer(onTimer, Math.max(0, dueAt - at));
      }
    },
    flush() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (queue.length > 0) {
        processQueued();
      }
    },
    dispose() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      queue = [];
    },
    get queuedCount() {
      return queue.length;
    },
    get gapMs() {
      return gapMs;
    },
  };
}
