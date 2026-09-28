import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coalesceStreamingSnapshots } from "../../../src/sdk/providers/streaming-snapshot-coalescing.js";
import type { SDKMessage } from "../../../src/sdk/types.js";

function snapshot(uuid: string, content: string): SDKMessage {
  return {
    type: "assistant",
    uuid,
    _isStreaming: true,
    message: { role: "assistant", content },
  } as SDKMessage;
}

function commit(uuid: string, content: string): SDKMessage {
  return {
    type: "assistant",
    uuid,
    message: { role: "assistant", content },
  } as SDKMessage;
}

function contentOf(message: SDKMessage): unknown {
  if (!message.uuid) return message.type;
  return `${message._isStreaming ? "~" : ""}${message.uuid}:${
    (message.message as { content: unknown }).content
  }`;
}

/** A provider stream the test feeds one message at a time. */
function providerStream() {
  const queued: IteratorResult<SDKMessage>[] = [];
  let waiting: ((result: IteratorResult<SDKMessage>) => void) | null = null;
  let failure: ((error: Error) => void) | null = null;
  const deliver = (result: IteratorResult<SDKMessage>) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      failure = null;
      resolve(result);
    } else queued.push(result);
  };
  const iterator: AsyncIterator<SDKMessage> = {
    next: () => {
      const result = queued.shift();
      if (result) return Promise.resolve(result);
      return new Promise((resolve, reject) => {
        waiting = resolve;
        failure = reject;
      });
    },
    return: vi.fn(
      async (): Promise<IteratorResult<SDKMessage>> => ({
        done: true,
        value: undefined,
      }),
    ),
  };
  return {
    iterator,
    push: (message: SDKMessage) => deliver({ done: false, value: message }),
    end: () => deliver({ done: true, value: undefined }),
    fail: (error: Error) => failure?.(error),
  };
}

/** Collects what the coalescer publishes, as it publishes it. */
function drain(source: AsyncIterator<SDKMessage>) {
  const published: unknown[] = [];
  const done = (async () => {
    for await (const message of coalesceStreamingSnapshots(source, 100)) {
      published.push(contentOf(message));
    }
  })();
  return { published, done };
}

describe("coalesceStreamingSnapshots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes a quiet stream's snapshot at once", async () => {
    const stream = providerStream();
    const { published } = drain(stream.iterator);
    stream.push(snapshot("a", "Hel"));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual(["~a:Hel"]);
  });

  it("publishes only the latest snapshot of a burst, once per interval", async () => {
    const stream = providerStream();
    const { published } = drain(stream.iterator);
    let text = "";
    for (const delta of ["He", "ll", "o ", "wo", "rl", "d"]) {
      text += delta;
      stream.push(snapshot("a", text));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual(["~a:He"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(published).toEqual(["~a:He", "~a:Hello world"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(published).toHaveLength(2);
  });

  it("replaces a held snapshot with the message's commit", async () => {
    const stream = providerStream();
    const { published } = drain(stream.iterator);
    stream.push(snapshot("a", "Hel"));
    stream.push(snapshot("a", "Hello"));
    stream.push(commit("a", "Hello."));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual(["~a:Hel", "a:Hello."]);
  });

  it("publishes held snapshots before any other message, in arrival order", async () => {
    const stream = providerStream();
    const { published } = drain(stream.iterator);
    stream.push(snapshot("a", "one"));
    stream.push(snapshot("a", "one two"));
    stream.push(snapshot("b", "tool"));
    stream.push(snapshot("a", "one two three"));
    stream.push({ type: "result", subtype: "success" } as SDKMessage);
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toEqual([
      "~a:one",
      "~a:one two three",
      "~b:tool",
      "result",
    ]);
  });

  it("publishes what it held when the stream ends or fails", async () => {
    const ended = providerStream();
    const endedRun = drain(ended.iterator);
    ended.push(snapshot("a", "x"));
    ended.push(snapshot("a", "xy"));
    ended.end();
    await endedRun.done;
    expect(endedRun.published).toEqual(["~a:x", "~a:xy"]);

    const failed = providerStream();
    const failedRun = drain(failed.iterator);
    failed.push(snapshot("a", "x"));
    failed.push(snapshot("a", "xy"));
    await vi.advanceTimersByTimeAsync(0);
    failed.fail(new Error("provider died"));
    await expect(failedRun.done).rejects.toThrow("provider died");
    expect(failedRun.published).toEqual(["~a:x", "~a:xy"]);
  });

  it("leaves no timer behind and closes the source when abandoned mid-read", async () => {
    const stream = providerStream();
    const coalesced = coalesceStreamingSnapshots(stream.iterator, 100);
    stream.push(snapshot("a", "x"));
    stream.push(snapshot("a", "xy"));
    await coalesced.next();
    const held = coalesced.next();
    await vi.advanceTimersByTimeAsync(100);
    expect(contentOf((await held).value as SDKMessage)).toBe("~a:xy");
    await coalesced.return?.();
    expect(stream.iterator.return).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
