import type { SDKMessage } from "../types.js";

/**
 * Shortest spacing between two published snapshots of one streaming message.
 * Matches the client's fastest streaming flush, so nothing a viewer could
 * paint is lost.
 */
export const STREAMING_SNAPSHOT_INTERVAL_MS = 100;

const DEADLINE = Symbol("streaming snapshot deadline");

/** Same-message identity of a live streaming snapshot, or null for any other message. */
function streamingSnapshotKey(message: SDKMessage): string | null {
  return message._isStreaming === true &&
    typeof message.uuid === "string" &&
    message.uuid
    ? `${message.type}:${message.uuid}`
    : null;
}

function settleBy<T>(
  promise: Promise<T>,
  delayMs: number,
): Promise<T | typeof DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), delayMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Rate-limits streaming snapshots: provider messages marked `_isStreaming`
 * that each replace the whole same-id message published before them. While
 * a stream is quiet a snapshot passes at once; under a burst each message
 * publishes at most one snapshot per interval, always its latest. Any other
 * provider message first publishes the held snapshots in arrival order, and
 * a message's own commit (the same id without `_isStreaming`) replaces its
 * held snapshot. Without this every provider delta republishes the whole
 * message, which costs bytes quadratic in its length for each viewer.
 *
 * Outside a burst `next()` returns the source's own read, adding no
 * asynchronous step to ordinary provider messages. Reads are sequential:
 * callers must not request the next message before the previous one settles.
 */
class StreamingSnapshotCoalescer implements AsyncIterableIterator<SDKMessage> {
  private readonly held = new Map<string, SDKMessage>();
  private readonly released: SDKMessage[] = [];
  private holdUntil = Number.NEGATIVE_INFINITY;
  private reading: Promise<IteratorResult<SDKMessage>> | null = null;
  private ended: IteratorResult<SDKMessage> | null = null;
  private failure: { error: unknown } | null = null;

  constructor(
    private readonly source: AsyncIterator<SDKMessage>,
    private readonly intervalMs: number,
  ) {}

  [Symbol.asyncIterator](): this {
    return this;
  }

  next(): Promise<IteratorResult<SDKMessage>> {
    const message = this.released.shift();
    if (message) return Promise.resolve({ done: false, value: message });
    if (this.failure) {
      const { error } = this.failure;
      this.failure = null;
      return Promise.reject(error);
    }
    if (this.ended) return Promise.resolve(this.ended);
    if (this.held.size > 0 || Date.now() < this.holdUntil) {
      return this.nextWhileHolding();
    }
    const read = this.read();
    read.then(
      (result) => {
        this.reading = null;
        if (!result.done && streamingSnapshotKey(result.value)) {
          this.holdUntil = Date.now() + this.intervalMs;
        }
      },
      () => {
        this.reading = null;
      },
    );
    return read;
  }

  async return(): Promise<IteratorResult<SDKMessage>> {
    this.held.clear();
    this.released.length = 0;
    this.ended = { done: true, value: undefined };
    if (this.reading) {
      // The source is mid-read; its return would wait behind that read.
      this.reading.catch(() => {});
      void Promise.resolve(this.source.return?.()).catch(() => {});
    } else {
      await this.source.return?.();
    }
    return this.ended;
  }

  private read(): Promise<IteratorResult<SDKMessage>> {
    this.reading ??= this.source.next();
    return this.reading;
  }

  private releaseHeld(): void {
    this.released.push(...this.held.values());
    this.held.clear();
  }

  private async nextWhileHolding(): Promise<IteratorResult<SDKMessage>> {
    for (;;) {
      let result: IteratorResult<SDKMessage> | typeof DEADLINE;
      try {
        const read = this.read();
        result =
          this.held.size === 0
            ? await read
            : await settleBy(read, this.holdUntil - Date.now());
      } catch (error) {
        this.reading = null;
        this.releaseHeld();
        this.failure = { error };
        return await this.next();
      }
      if (result === DEADLINE) {
        this.releaseHeld();
        this.holdUntil = Date.now() + this.intervalMs;
        return await this.next();
      }
      this.reading = null;
      if (result.done) {
        this.releaseHeld();
        this.ended = result;
        return await this.next();
      }
      const message = result.value;
      const key = streamingSnapshotKey(message);
      if (key) {
        if (this.held.size === 0 && Date.now() >= this.holdUntil) {
          this.holdUntil = Date.now() + this.intervalMs;
          return result;
        }
        this.held.set(key, message);
        continue;
      }
      if (typeof message.uuid === "string" && message.uuid) {
        this.held.delete(`${message.type}:${message.uuid}`);
      }
      this.releaseHeld();
      this.released.push(message);
      return await this.next();
    }
  }
}

export function coalesceStreamingSnapshots(
  source: AsyncIterator<SDKMessage>,
  intervalMs = STREAMING_SNAPSHOT_INTERVAL_MS,
): AsyncIterableIterator<SDKMessage> {
  return new StreamingSnapshotCoalescer(source, intervalMs);
}
