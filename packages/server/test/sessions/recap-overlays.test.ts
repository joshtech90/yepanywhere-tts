import type {
  DurableRecapMessage,
  DurableSyntheticDoneMessage,
} from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  applyRecapOverlayToSummary,
  mergeRecapMessages,
  mergeSessionOverlayMessages,
  type SessionRuntimeProcess,
  sessionRowRuntimeOverlay,
} from "../../src/sessions/recap-overlays.js";
import type { Message, SessionSummary } from "../../src/supervisor/types.js";

function recap(
  overrides: Partial<DurableRecapMessage> & {
    uuid: string;
    content: string;
  },
): DurableRecapMessage {
  return {
    type: "system",
    subtype: "away_summary",
    timestamp: "2026-06-24T12:00:00.000Z",
    id: overrides.uuid,
    yaRecapSource: "ya-synthetic",
    ...overrides,
  };
}

function providerMessage(
  overrides: Partial<Message> & { uuid: string },
): Message {
  return {
    type: "assistant",
    timestamp: "2026-06-24T12:00:00.000Z",
    message: { role: "assistant", content: "assistant text" },
    ...overrides,
  };
}

function done(uuid: string, timestamp: string): DurableSyntheticDoneMessage {
  return {
    type: "user",
    content: "/done",
    message: { role: "user", content: "/done" },
    timestamp,
    uuid,
    id: uuid,
    isSynthetic: true,
    yaSyntheticSource: "done",
  };
}

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "sess-1",
    projectId: "proj-1" as SessionSummary["projectId"],
    title: "Session",
    fullTitle: "Session",
    createdAt: "2026-06-24T11:00:00.000Z",
    updatedAt: "2026-06-24T12:00:00.000Z",
    messageCount: 1,
    ownership: { owner: "none" },
    provider: "claude",
    ...overrides,
  };
}

describe("recap overlays", () => {
  it("renders same-content persisted recaps within the duplicate window once", () => {
    const merged = mergeRecapMessages(
      [],
      [
        recap({
          uuid: "recap-1",
          content: "Finished the cleanup.",
          timestamp: "2026-06-24T12:00:00.000Z",
        }),
        recap({
          uuid: "recap-2",
          content: "Finished the cleanup.",
          timestamp: "2026-06-24T12:00:04.000Z",
        }),
      ],
    );

    expect(merged.map((message) => message.uuid)).toEqual(["recap-1"]);
  });

  it("dedupes persisted recaps with the same UUID", () => {
    const merged = mergeRecapMessages(
      [],
      [
        recap({
          uuid: "recap-1",
          content: "First copy.",
          timestamp: "2026-06-24T12:00:00.000Z",
        }),
        recap({
          uuid: "recap-1",
          content: "Second copy.",
          timestamp: "2026-06-24T12:00:10.000Z",
        }),
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.uuid).toBe("recap-1");
  });

  it("suppresses durable overlays equivalent to provider away summaries", () => {
    const merged = mergeRecapMessages(
      [
        providerMessage({
          uuid: "native-recap",
          type: "system",
          subtype: "away_summary",
          content: "Native recap wins.",
          timestamp: "2026-06-24T12:00:00.000Z",
        }),
      ],
      [
        recap({
          uuid: "overlay-recap",
          content: "Native recap wins.",
          timestamp: "2026-06-24T12:00:03.000Z",
        }),
      ],
    );

    expect(merged.map((message) => message.uuid)).toEqual(["native-recap"]);
  });

  it("appends invalid-timestamp recaps without crashing", () => {
    const merged = mergeRecapMessages(
      [
        providerMessage({
          uuid: "provider-1",
          timestamp: "2026-06-24T12:00:30.000Z",
        }),
      ],
      [
        recap({
          uuid: "recap-invalid",
          content: "Timestamp was missing.",
          timestamp: null as unknown as string,
        }),
      ],
    );

    expect(merged.map((message) => message.uuid)).toEqual([
      "provider-1",
      "recap-invalid",
    ]);
  });

  it("inserts timestamped recaps before later provider messages", () => {
    const merged = mergeRecapMessages(
      [
        providerMessage({
          uuid: "provider-later",
          timestamp: "2026-06-24T12:00:30.000Z",
        }),
      ],
      [
        recap({
          uuid: "recap-earlier",
          content: "Earlier recap.",
          timestamp: "2026-06-24T12:00:10.000Z",
        }),
      ],
    );

    expect(merged.map((message) => message.uuid)).toEqual([
      "recap-earlier",
      "provider-later",
    ]);
  });

  it("supersedes an older overlay recap with no provider content after it", () => {
    const merged = mergeRecapMessages(
      [
        providerMessage({
          uuid: "provider-1",
          timestamp: "2026-06-24T12:00:00.000Z",
        }),
      ],
      [
        recap({
          uuid: "recap-old",
          content: "First recap.",
          timestamp: "2026-06-24T12:00:10.000Z",
        }),
        recap({
          uuid: "recap-new",
          content: "Second recap.",
          timestamp: "2026-06-24T12:02:00.000Z",
        }),
      ],
    );

    expect(merged.map((message) => message.uuid)).toEqual([
      "provider-1",
      "recap-new",
    ]);
  });

  it("keeps an older overlay recap when provider content follows it", () => {
    const merged = mergeRecapMessages(
      [
        providerMessage({
          uuid: "provider-1",
          timestamp: "2026-06-24T12:00:00.000Z",
        }),
        providerMessage({
          uuid: "provider-2",
          timestamp: "2026-06-24T12:01:00.000Z",
        }),
      ],
      [
        recap({
          uuid: "recap-old",
          content: "First recap.",
          timestamp: "2026-06-24T12:00:10.000Z",
        }),
        recap({
          uuid: "recap-new",
          content: "Second recap.",
          timestamp: "2026-06-24T12:02:00.000Z",
        }),
      ],
    );

    expect(merged.map((message) => message.uuid)).toEqual([
      "provider-1",
      "recap-old",
      "provider-2",
      "recap-new",
    ]);
  });

  it("keeps done rows in timestamp order as recap boundaries", () => {
    const merged = mergeSessionOverlayMessages(
      [
        providerMessage({
          uuid: "provider-1",
          timestamp: "2026-06-24T12:00:00.000Z",
        }),
      ],
      [
        recap({
          uuid: "recap-old",
          content: "First recap.",
          timestamp: "2026-06-24T12:00:10.000Z",
        }),
        recap({
          uuid: "recap-new",
          content: "Second recap.",
          timestamp: "2026-06-24T12:02:00.000Z",
        }),
      ],
      [done("done-1", "2026-06-24T12:01:00.000Z")],
    );

    expect(merged.map((message) => message.uuid)).toEqual([
      "provider-1",
      "recap-old",
      "done-1",
      "recap-new",
    ]);
  });

  it("never removes a provider-emitted recap row when superseding", () => {
    const merged = mergeRecapMessages(
      [
        providerMessage({
          uuid: "native-recap",
          type: "system",
          subtype: "away_summary",
          content: "Native recap text.",
          timestamp: "2026-06-24T12:00:10.000Z",
        }),
      ],
      [
        recap({
          uuid: "overlay-recap",
          content: "Different overlay recap.",
          timestamp: "2026-06-24T12:02:00.000Z",
        }),
      ],
    );

    expect(merged.map((message) => message.uuid)).toEqual([
      "native-recap",
      "overlay-recap",
    ]);
  });

  it("updates summary freshness and excerpt only for fresher valid recaps", () => {
    const base = summary({
      updatedAt: "2026-06-24T12:00:00.000Z",
      lastAgentText: "Provider ending.",
    });

    expect(
      applyRecapOverlayToSummary(base, [
        recap({
          uuid: "old-recap",
          content: "Older recap.",
          timestamp: "2026-06-24T11:59:00.000Z",
        }),
      ]),
    ).toBe(base);

    expect(
      applyRecapOverlayToSummary(base, [
        recap({
          uuid: "invalid-recap",
          content: "Invalid recap.",
          timestamp: "not-a-date",
        }),
      ]),
    ).toBe(base);

    expect(
      applyRecapOverlayToSummary(base, [
        recap({
          uuid: "fresh-recap",
          content: "Fresh recap. (disable recaps in /config)",
          timestamp: "2026-06-24T12:01:00.000Z",
        }),
      ]),
    ).toMatchObject({
      updatedAt: "2026-06-24T12:01:00.000Z",
      lastAgentText: "Fresh recap.",
    });
  });
});

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
