import { afterEach, expect, it, vi } from "vitest";
import {
  ContentSearchPool,
  ContentSearchScan,
  MAX_CACHED_MATCHES_PER_SESSION,
  scanDone,
  type SessionScan,
} from "./ContentSearchScan";

const isDone = (entry: SessionScan | undefined) => !!entry && scanDone(entry);

afterEach(() => vi.useRealTimers());
const hit = {
  id: "old",
  role: "user" as const,
  ordinal: 1,
  preview: "needle old",
};
const done = {
  matches: [hit],
  done: true,
  partial: false,
  bytesRead: 1,
  resumeCursor: "tail",
};

it("aborts hidden work without losing its cursor or accepting a late response", async () => {
  vi.useFakeTimers();
  let finish!: (value: typeof done) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(done)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  scan.update(new Map([["a", "1"]]));
  await vi.advanceTimersByTimeAsync(32);
  scan.update(new Map([["a", "2"]]));
  await vi.advanceTimersByTimeAsync(32);
  scan.setInterested(false);
  expect(fetch.mock.calls[1]![1].signal.aborted).toBe(true);
  scan.update(new Map([["a", "3"]]));
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2);
  scan.setInterested(true);
  finish({ ...done, matches: [{ ...hit, id: "stale" }] });
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(scan.entries.get("a")?.matches).toEqual([hit]);
  expect(
    fetch.mock.calls
      .slice(2)
      .every(([, options]) => JSON.parse(options.body).cursor === "tail"),
  ).toBe(true);
  expect(isDone(scan.entries.get("a"))).toBe(true);
  scan.stop();
});

it("resumes only changed sessions, adds new sessions, and excludes filtered IDs before traversal", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  scan.update(
    new Map([
      ["a", "1"],
      ["b", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  expect(fetch).toHaveBeenCalledTimes(2);
  scan.update(
    new Map([
      ["b", "1"],
      ["a", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue({ ...done, matches: [{ ...hit, id: "new" }] });
  scan.update(
    new Map([
      ["a", "2"],
      ["c", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  const requests = fetch.mock.calls
    .slice(2)
    .map(([, options]) => JSON.parse(options.body));
  expect(requests).toEqual([
    {
      sessionId: "a",
      query: "needle",
      roles: ["user"],
      cursor: "tail",
      allowRestart: true,
      includeSearchText: true,
    },
    {
      sessionId: "c",
      query: "needle",
      roles: ["user"],
      allowRestart: true,
      includeSearchText: true,
    },
  ]);
  expect(scan.entries.get("a")?.matches.map((m) => m.id)).toEqual([
    "old",
    "new",
  ]);
  fetch.mockResolvedValue({ ...done, matches: [], replacedIds: ["old"] });
  scan.update(new Map([["a", "3"]]));
  await vi.advanceTimersByTimeAsync(32);
  expect(scan.entries.get("a")?.matches.map((m) => m.id)).toEqual(["new"]);
  scan.stop();
});

it("interleaves batches and continues after an unavailable session", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ...done,
      done: false,
      cursor: "next",
      resumeCursor: undefined,
    })
    .mockRejectedValueOnce(
      Object.assign(new Error("Project unavailable"), { status: 404 }),
    )
    .mockResolvedValueOnce(done)
    .mockResolvedValueOnce(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  scan.update(
    new Map([
      ["large", "1"],
      ["missing", "1"],
      ["target", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  expect(
    fetch.mock.calls.map(([, options]) => JSON.parse(options.body).sessionId),
  ).toEqual(["large", "missing", "target", "large"]);
  expect(scan.entries.get("missing")?.partial).toBe("Project unavailable");
  expect(scan.entries.get("target")?.matches).toEqual([hit]);
  scan.stop();
});

it("does not restart in-flight traversal when another session changes or the set narrows", async () => {
  vi.useFakeTimers();
  let finish!: (value: typeof done) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(done);
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
    new ContentSearchPool(1),
  );
  scan.update(
    new Map([
      ["a", "1"],
      ["b", "1"],
      ["excluded", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(32);
  scan.update(
    new Map([
      ["a", "1"],
      ["b", "2"],
    ]),
  );
  finish(done);
  await vi.advanceTimersByTimeAsync(32);
  expect(
    fetch.mock.calls.map(([, options]) => JSON.parse(options.body).sessionId),
  ).toEqual(["a", "b"]);
  scan.stop();
});

it("fans out session reads within a shared limit and never overlaps a session's cursor", async () => {
  vi.useFakeTimers();
  const pending: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        peak = Math.max(peak, ++active);
        pending.push(() => {
          active--;
          resolve(done);
        });
      }),
  );
  const pool = new ContentSearchPool();
  const first = new ContentSearchScan(
    "n",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
    pool,
  );
  const second = new ContentSearchScan(
    "ne",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
    pool,
  );
  const wanted = new Map(Array.from({ length: 6 }, (_, i) => [String(i), "1"]));
  first.update(wanted);
  await vi.advanceTimersByTimeAsync(32);
  expect(fetch).toHaveBeenCalledTimes(4);
  first.update(wanted);
  second.update(wanted);
  await vi.advanceTimersByTimeAsync(32);
  expect(fetch).toHaveBeenCalledTimes(4);
  while (pending.length) {
    pending.shift()!();
    await vi.advanceTimersByTimeAsync(32);
  }
  expect(peak).toBe(4);
  expect(fetch).toHaveBeenCalledTimes(12);
  expect(
    [...first.entries.values(), ...second.entries.values()].every(scanDone),
  ).toBe(true);
  first.stop();
  second.stop();
});

it("refines whole text beyond the first excerpt, then resumes the same tail for live content", async () => {
  vi.useFakeTimers();
  const searchText = `needle ${"x".repeat(500)} needle extended`;
  const fetch = vi.fn().mockResolvedValue({
    ...done,
    includesSearchText: true,
    matches: [{ ...hit, searchText }],
  });
  const first = new ContentSearchScan(
    "needle",
    { roles: ["user", "assistant"] },
    { fetch },
    vi.fn(),
  );
  first.update(new Map([["a", "1"]]));
  await vi.advanceTimersByTimeAsync(32);
  expect(first.entries.get("a")?.matches[0]?.preview).not.toContain("extended");
  const second = new ContentSearchScan(
    "needle extended",
    { roles: ["user", "assistant"] },
    { fetch },
    vi.fn(),
  );
  second.seedFrom(first);
  first.stop();
  second.update(new Map([["a", "1"]]));
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(isDone(second.entries.get("a"))).toBe(true);
  expect(second.entries.get("a")?.matches[0]?.preview).toContain(
    "needle extended",
  );
  fetch.mockResolvedValue({
    ...done,
    includesSearchText: true,
    matches: [
      { ...hit, id: "new", searchText: "needle extended live" },
      { ...hit, id: "nonmatch", searchText: "needle only" },
    ],
  });
  second.update(new Map([["a", "2"]]));
  await vi.advanceTimersByTimeAsync(32);
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({
    query: "needle",
    cursor: "tail",
  });
  expect(second.entries.get("a")?.matches.map((m) => m.id)).toEqual([
    "old",
    "new",
  ]);
  second.stop();
});

it("stops at the match cap, drops full text, and restarts only capped sessions for the next needle", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(async (_path, options) => {
    const { sessionId, query, cursor } = JSON.parse(options.body);
    const offset = cursor ? Number(cursor) : 0;
    return {
      ...done,
      done: false,
      cursor: String(offset + 128),
      includesSearchText: true,
      matches:
        sessionId === "large" && query === "n"
          ? Array.from({ length: 128 }, (_, i) => ({
              ...hit,
              id: String(offset + i),
              searchText: "needle",
            }))
          : [{ ...hit, searchText: "needle" }],
      ...(sessionId !== "large" ||
      query !== "n" ||
      offset >= MAX_CACHED_MATCHES_PER_SESSION
        ? { done: true }
        : {}),
    };
  });
  const wanted = new Map([
    ["large", "1"],
    ["small", "1"],
  ]);
  const first = new ContentSearchScan(
    "n",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  first.update(wanted);
  await vi.advanceTimersByTimeAsync(100);
  const large = first.entries.get("large")!;
  expect(large.matches).toHaveLength(MAX_CACHED_MATCHES_PER_SESSION);
  expect(large.phase).toEqual({ kind: "limited" });
  expect(large.matches.every((m) => m.searchText === undefined)).toBe(true);
  expect(large.retainedBytes).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(9);
  first.update(
    new Map([
      ["large", "2"],
      ["small", "1"],
    ]),
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(9);
  const second = new ContentSearchScan(
    "ne",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  second.seedFrom(first);
  first.stop();
  second.update(wanted);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(10);
  expect(JSON.parse(fetch.mock.calls[9]![1].body)).toMatchObject({
    query: "ne",
    sessionId: "large",
  });
  expect(isDone(second.entries.get("small"))).toBe(true);
  second.stop();
});

it("enforces a text-byte cap independently of the match count", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({
    ...done,
    done: false,
    cursor: "more",
    includesSearchText: true,
    matches: [{ ...hit, searchText: "needle".repeat(50) }],
  });
  const scan = new ContentSearchScan(
    "needle",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
    new ContentSearchPool(),
    { matches: 1024, sessionBytes: 100, scanBytes: 1000 },
  );
  scan.update(new Map([["a", "1"]]));
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(scan.entries.get("a")).toMatchObject({
    phase: { kind: "limited" },
    retainedBytes: 0,
  });
  scan.stop();
});

it("reuses the original cache when another character interrupts pending refinement", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({
    ...done,
    includesSearchText: true,
    matches: [{ ...hit, searchText: "needle" }],
  });
  const first = new ContentSearchScan(
    "n",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  const wanted = new Map([["a", "1"]]);
  first.update(wanted);
  await vi.advanceTimersByTimeAsync(100);
  const middle = new ContentSearchScan(
    "ne",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  middle.seedFrom(first);
  middle.update(wanted);
  const last = new ContentSearchScan(
    "nee",
    { roles: ["user"] },
    { fetch },
    vi.fn(),
  );
  last.seedFrom(middle);
  first.stop();
  middle.stop();
  last.update(wanted);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(isDone(last.entries.get("a"))).toBe(true);
  expect(last.entries.get("a")).toMatchObject({
    matches: [{ ...hit, preview: "needle", searchText: "needle" }],
  });
  last.stop();
});
