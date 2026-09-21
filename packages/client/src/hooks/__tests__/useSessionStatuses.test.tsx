// @vitest-environment jsdom

import { SESSION_UNREAD_TIMESTAMP } from "@yep-anywhere/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { activityBus, type SessionSeenEvent } from "../../lib/activityBus";
import { useSessionStatuses } from "../useSessionStatuses";

function seen(timestamp: string): SessionSeenEvent {
  return { type: "session-seen", sessionId: "sess1", timestamp };
}

afterEach(() => {
  cleanup();
});

describe("useSessionStatuses read state", () => {
  it("reads the unread timestamp as unread", () => {
    const { result } = renderHook(() => useSessionStatuses(["sess1"]));

    act(() => {
      activityBus.emitLocal("session-seen", seen(SESSION_UNREAD_TIMESTAMP));
    });

    expect(result.current.get("sess1")?.hasUnread).toBe(true);
  });

  it("reads a real timestamp as read", () => {
    const { result } = renderHook(() => useSessionStatuses(["sess1"]));

    act(() => {
      activityBus.emitLocal("session-seen", seen(SESSION_UNREAD_TIMESTAMP));
      activityBus.emitLocal("session-seen", seen(new Date().toISOString()));
    });

    expect(result.current.get("sess1")?.hasUnread).toBe(false);
  });
});
