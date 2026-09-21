// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionContentSearchBatch } from "@yep-anywhere/shared";
import type { GlobalSessionItem } from "../../api/client";
import { useContentSearch } from "./useContentSearch";
import type { SearchField } from "./model";

const runtime = vi.hoisted(() => ({
  sourceKey: "search-test",
  transport: { fetch: vi.fn() },
}));
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
beforeEach(() => {
  vi.useFakeTimers();
  runtime.transport.fetch.mockReset();
  runtime.sourceKey = "search-test";
});

it("keeps title-only local, acquires both roles once, and reuses them across role and time changes", async () => {
  const session = { id: "a", updatedAt: "1" } as GlobalSessionItem;
  const matches = ["user", "assistant"].map((role) => ({
    id: role,
    role,
    ordinal: 1,
    preview: "needle",
    searchText: "needle complete",
    timestamp: "2026-09-14T00:00:00Z",
  }));
  runtime.transport.fetch.mockResolvedValue({
    matches,
    done: true,
    partial: false,
    bytesRead: 20,
    includesSearchText: true,
    resumeCursor: "tail",
  });
  const { result, rerender } = renderHook(
    ({ fields, after }: { fields: SearchField[]; after?: number }) =>
      useContentSearch([session], "needle", fields, true, after),
    {
      initialProps: {
        fields: ["title"] as SearchField[],
        after: undefined as number | undefined,
      },
    },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(runtime.transport.fetch).not.toHaveBeenCalled();
  rerender({ fields: ["user"], after: undefined });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(
    JSON.parse(runtime.transport.fetch.mock.calls[0]![1].body).roles,
  ).toEqual(["assistant", "user"]);
  expect(result.current.matches.get("a")?.map((m) => m.role)).toEqual(["user"]);
  rerender({ fields: ["assistant"], after: undefined });
  expect(result.current.matches.get("a")?.map((m) => m.role)).toEqual([
    "assistant",
  ]);
  rerender({ fields: ["assistant"], after: Date.parse("2026-09-15") });
  expect(result.current.matches.size).toBe(0);
  rerender({ fields: ["title"], after: undefined });
  rerender({ fields: ["assistant", "user"], after: undefined });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(result.current.matches.get("a")).toHaveLength(2);
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(1);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("distinguishes new-session acquisition from quiet live-tail catch-up", async () => {
  const session = { id: "a", updatedAt: "1" } as GlobalSessionItem;
  runtime.transport.fetch.mockResolvedValue({
    matches: [],
    done: true,
    partial: false,
    bytesRead: 0,
    resumeCursor: "tail",
  });
  const { result, rerender } = renderHook(
    ({ sessions }) => useContentSearch(sessions, "needle", ["user"], true),
    { initialProps: { sessions: [session] } },
  );
  expect(result.current.acquiring).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(result.current.acquiring).toBe(false);
  runtime.transport.fetch.mockImplementation(() => new Promise(() => {}));
  const changed = { ...session, updatedAt: "2" };
  rerender({ sessions: [changed] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  rerender({ sessions: [changed] });
  expect(result.current.running).toBe(true);
  expect(result.current.acquiring).toBe(false);
  rerender({ sessions: [changed, { ...session, id: "b" }] });
  expect(result.current.acquiring).toBe(true);
});

it("defers hidden-page catch-up and resumes retained cursors on visibility", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("visible");
  const match = { id: "turn", role: "user", ordinal: 1, preview: "needle" };
  runtime.transport.fetch.mockResolvedValue({
    matches: [match],
    done: true,
    partial: false,
    bytesRead: 20,
    resumeCursor: "tail",
  });
  const session = { id: "a", updatedAt: "1" } as GlobalSessionItem;
  const { result, rerender } = renderHook(
    ({ session }) => useContentSearch([session], "needle", ["user"], true),
    { initialProps: { session } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(1);
  act(() => {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  rerender({ session: { ...session, updatedAt: "2" } });
  rerender({ session: { ...session, updatedAt: "3" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(1);
  expect(result.current.matches.get("a")).toEqual([match]);
  act(() => {
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(runtime.transport.fetch.mock.calls[1]![1].body).cursor,
  ).toBe("tail");
});

it("refines multiple completed sessions through the hook without acquisition", async () => {
  const sessions = Array.from(
    { length: 6 },
    (_, i) => ({ id: String(i), updatedAt: "1" }) as GlobalSessionItem,
  );
  runtime.transport.fetch.mockImplementation(async (_path, options) => {
    const { sessionId } = JSON.parse(options.body);
    return {
      done: true,
      partial: false,
      bytesRead: 1,
      resumeCursor: "tail",
      includesSearchText: true,
      matches: [
        {
          id: "turn",
          role: "user",
          ordinal: 1,
          preview: `needle ${sessionId}`,
          searchText: `needle ${sessionId}`,
        },
      ],
    };
  });
  const { result, rerender } = renderHook(
    ({ query }) =>
      useContentSearch(
        sessions,
        query,
        ["user", "assistant"],
        true,
        undefined,
        undefined,
        1,
      ),
    { initialProps: { query: "needle" } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(result.current.running).toBe(false);
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(6);
  rerender({ query: "needle 2" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(result.current.running).toBe(false);
  expect([...result.current.matches.keys()]).toEqual(["2"]);
  expect(runtime.transport.fetch).toHaveBeenCalledTimes(6);
});

it("coalesces queued needles and keeps only two query generations", async () => {
  const session = { id: "a", updatedAt: "1" } as GlobalSessionItem;
  runtime.transport.fetch.mockImplementation(() => new Promise(() => {}));
  const { rerender, unmount } = renderHook(
    ({ query }) => useContentSearch([session], query, ["user"], true),
    { initialProps: { query: "9" } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  rerender({ query: "98" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  rerender({ query: "987" });
  rerender({ query: "9876" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const requests = runtime.transport.fetch.mock.calls.map(([, options]) => ({
    query: JSON.parse(options.body).query,
    aborted: options.signal.aborted,
  }));
  expect(requests).toEqual([
    { query: "9", aborted: false },
    { query: "98", aborted: true },
    { query: "9876", aborted: false },
  ]);
  unmount();
});

it("republishes its maps only when a scan publishes", async () => {
  const session = { id: "a", updatedAt: "1" } as GlobalSessionItem;
  runtime.transport.fetch.mockResolvedValue({
    matches: [{ id: "turn", role: "user", ordinal: 1, preview: "needle" }],
    done: true,
    partial: false,
    bytesRead: 20,
  });
  const sessions = [session];
  const { result, rerender } = renderHook(
    ({ sessions }) => useContentSearch(sessions, "needle", ["user"], true),
    { initialProps: { sessions } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const published = result.current;
  expect(published.matches.get("a")).toHaveLength(1);
  rerender({ sessions });
  rerender({ sessions });
  expect(result.current.matches).toBe(published.matches);
  expect(result.current.partial).toBe(published.partial);
  expect(result.current.diagnostics).toBe(published.diagnostics);
  expect(result.current.limitedSessions).toBe(published.limitedSessions);
});

it("keeps discovered matches through empty revalidation batches after metadata changes", async () => {
  const match = {
    id: "turn",
    role: "user" as const,
    ordinal: 1,
    preview: "needle in turn",
  };
  const done: SessionContentSearchBatch = {
    matches: [match],
    done: true,
    partial: false,
    bytesRead: 20,
  };
  runtime.transport.fetch.mockResolvedValueOnce(done);
  const session = {
    id: "session",
    updatedAt: "2026-09-14T00:00:00Z",
  } as GlobalSessionItem;
  const { result, rerender, unmount } = renderHook(
    ({ sessions }) => useContentSearch(sessions, "needle", ["user"], true),
    { initialProps: { sessions: [session] } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(false);

  let finish!: (batch: SessionContentSearchBatch) => void;
  runtime.transport.fetch.mockResolvedValueOnce({
    matches: [],
    done: false,
    cursor: "next",
    partial: false,
    bytesRead: 20,
  });
  runtime.transport.fetch.mockImplementationOnce(
    () =>
      new Promise<SessionContentSearchBatch>((resolve) => {
        finish = resolve;
      }),
  );
  rerender({ sessions: [{ ...session, updatedAt: "2026-09-14T01:00:00Z" }] });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(true);
  await act(async () => {
    finish(done);
    await vi.advanceTimersByTimeAsync(40);
  });
  expect(result.current.matches.get("session")).toEqual([match]);
  expect(result.current.running).toBe(false);
  const options = runtime.transport.fetch.mock.calls.at(-1)![1];
  unmount();
  expect(options.signal.aborted).toBe(true);
});
