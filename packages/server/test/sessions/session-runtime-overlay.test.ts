import { describe, expect, it } from "vitest";
import {
  type SessionRuntimeProcess,
  sessionActivityEventFromProcess,
  sessionRowRuntimeOverlay,
} from "../../src/sessions/session-runtime-overlay.js";

function runtimeProcess(
  overrides: Partial<SessionRuntimeProcess> & { state: { type: string } },
): SessionRuntimeProcess {
  return {
    id: "proc-1",
    permissionMode: "default",
    modeVersion: 3,
    recapAfterSeconds: 90,
    isRetainingProviderWork: () => false,
    getPendingInputRequest: () => null,
    ...overrides,
  };
}

describe("sessionRowRuntimeOverlay", () => {
  it("prefers an owned process, then an external session, then the row's own ownership", () => {
    const externalTracker = { isExternal: () => true };
    expect(
      sessionRowRuntimeOverlay(runtimeProcess({ state: { type: "idle" } }), {
        sessionId: "sess-1",
        providerUpdatedAt: "2026-06-24T12:00:00.000Z",
        externalTracker,
        fallbackOwnership: { owner: "external" },
      }).ownership,
    ).toEqual({
      owner: "self",
      processId: "proc-1",
      permissionMode: "default",
      appliedPermissionMode: undefined,
      modeVersion: 3,
      recapAfterSeconds: 90,
    });

    expect(
      sessionRowRuntimeOverlay(undefined, {
        sessionId: "sess-1",
        providerUpdatedAt: "2026-06-24T12:00:00.000Z",
        externalTracker,
        fallbackOwnership: { owner: "none" },
      }).ownership,
    ).toEqual({ owner: "external" });

    expect(
      sessionRowRuntimeOverlay(undefined, {
        sessionId: "sess-1",
        providerUpdatedAt: "2026-06-24T12:00:00.000Z",
        externalTracker: { isExternal: () => false },
        fallbackOwnership: { owner: "self", processId: "stored-proc" },
      }).ownership,
    ).toEqual({ owner: "self", processId: "stored-proc" });

    expect(
      sessionRowRuntimeOverlay(undefined, {
        sessionId: "sess-1",
        providerUpdatedAt: "2026-06-24T12:00:00.000Z",
      }).ownership,
    ).toEqual({ owner: "none" });
  });

  it("reports an idle process that retains provider work as in-turn", () => {
    const overlay = sessionRowRuntimeOverlay(
      runtimeProcess({
        state: { type: "idle" },
        isRetainingProviderWork: () => true,
      }),
      {
        sessionId: "sess-1",
        providerUpdatedAt: "2026-06-24T12:00:00.000Z",
      },
    );
    expect(overlay.activity).toBe("in-turn");

    expect(
      sessionRowRuntimeOverlay(runtimeProcess({ state: { type: "idle" } }), {
        sessionId: "sess-1",
        providerUpdatedAt: "2026-06-24T12:00:00.000Z",
      }).activity,
    ).toBeUndefined();

    expect(
      sessionRowRuntimeOverlay(
        runtimeProcess({ state: { type: "waiting-input" } }),
        {
          sessionId: "sess-1",
          providerUpdatedAt: "2026-06-24T12:00:00.000Z",
        },
      ).activity,
    ).toBe("waiting-input");
  });

  it("names a pending request by kind and reads unread against the provider timestamp", () => {
    const seen = new Map([["sess-1", "2026-06-24T12:00:00.000Z"]]);
    const notificationService = {
      hasUnread: (sessionId: string, updatedAt: string) =>
        updatedAt > (seen.get(sessionId) ?? ""),
    } as unknown as Parameters<
      typeof sessionRowRuntimeOverlay
    >[1]["notificationService"];

    expect(
      sessionRowRuntimeOverlay(
        runtimeProcess({
          state: { type: "waiting-input" },
          getPendingInputRequest: () => ({ type: "tool-approval" }),
        }),
        {
          sessionId: "sess-1",
          providerUpdatedAt: "2026-06-24T12:01:00.000Z",
          notificationService,
        },
      ),
    ).toMatchObject({ pendingInputType: "tool-approval", hasUnread: true });

    expect(
      sessionRowRuntimeOverlay(
        runtimeProcess({
          state: { type: "waiting-input" },
          getPendingInputRequest: () => ({ type: "user-input" }),
        }),
        {
          sessionId: "sess-1",
          providerUpdatedAt: "2026-06-24T11:59:00.000Z",
          notificationService,
        },
      ),
    ).toMatchObject({ pendingInputType: "user-question", hasUnread: false });
  });
});

describe("sessionActivityEventFromProcess", () => {
  it("reports the row's activity and pending input, with no activity as idle", () => {
    expect(
      sessionActivityEventFromProcess(
        runtimeProcess({
          state: { type: "idle" },
          isRetainingProviderWork: () => true,
        }),
      ),
    ).toEqual({ activity: "in-turn", pendingInputType: undefined });

    expect(
      sessionActivityEventFromProcess(
        runtimeProcess({ state: { type: "idle" } }),
      ),
    ).toEqual({ activity: "idle", pendingInputType: undefined });

    expect(
      sessionActivityEventFromProcess(
        runtimeProcess({
          state: { type: "waiting-input" },
          getPendingInputRequest: () => ({ type: "question" }),
        }),
      ),
    ).toEqual({ activity: "waiting-input", pendingInputType: "user-question" });
  });
});
