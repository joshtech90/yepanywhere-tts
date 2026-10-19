// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { setSessionUnread } from "../../lib/sessionReadActions";
import { useEngagementTracking } from "../useEngagementTracking";

vi.mock("../../api/client", () => ({
  api: {
    markSessionSeen: vi.fn(),
    markSessionUnread: vi.fn(),
  },
}));

const timestamp = "2026-10-18T12:00:00.000Z";
const options = {
  sessionId: "manual-read",
  activityAt: timestamp,
  updatedAt: timestamp,
  hasUnread: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.mocked(api.markSessionSeen).mockResolvedValue({ marked: true });
  vi.mocked(api.markSessionUnread).mockResolvedValue({ marked: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("cancels a queued automatic read and holds unread through streaming until an explicit read", async () => {
  const { rerender } = renderHook(useEngagementTracking, {
    initialProps: options,
  });
  await act(() => setSessionUnread(options.sessionId, true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(api.markSessionSeen).not.toHaveBeenCalled();

  rerender({ ...options, activityAt: "2026-10-18T12:01:00.000Z" });
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(api.markSessionSeen).not.toHaveBeenCalled();

  await act(() => setSessionUnread(options.sessionId, false));
  expect(api.markSessionSeen).toHaveBeenCalledTimes(1);
  rerender({ ...options, activityAt: "2026-10-18T12:02:00.000Z" });
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(api.markSessionSeen).toHaveBeenCalledTimes(2);
});

it("drains an automatic read already in flight before writing manual unread", async () => {
  let finishRead!: (value: { marked: boolean }) => void;
  vi.mocked(api.markSessionSeen).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  renderHook(() => useEngagementTracking(options));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  const unread = setSessionUnread(options.sessionId, true);
  await act(async () => {
    await Promise.resolve();
  });
  expect(api.markSessionUnread).not.toHaveBeenCalled();
  await act(async () => {
    finishRead({ marked: true });
    await unread;
  });
  expect(api.markSessionUnread).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(api.markSessionSeen).toHaveBeenCalledTimes(1);
});

it("keeps rapid explicit actions in order even while a previous write is pending", async () => {
  let finishUnread!: (value: { marked: boolean }) => void;
  vi.mocked(api.markSessionUnread).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishUnread = resolve;
      }),
  );
  const unread = setSessionUnread(options.sessionId, true);
  await Promise.resolve();
  await Promise.resolve();
  const read = setSessionUnread(options.sessionId, false);
  await Promise.resolve();
  expect(api.markSessionSeen).not.toHaveBeenCalled();
  finishUnread({ marked: false });
  await Promise.all([unread, read]);
  expect(api.markSessionSeen).toHaveBeenCalledTimes(1);
});

it("restores automatic tracking if the explicit unread write fails", async () => {
  vi.mocked(api.markSessionUnread).mockRejectedValueOnce(new Error("offline"));
  renderHook(() => useEngagementTracking(options));
  await expect(setSessionUnread(options.sessionId, true)).rejects.toThrow(
    "offline",
  );
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(api.markSessionSeen).toHaveBeenCalledTimes(1);
});
