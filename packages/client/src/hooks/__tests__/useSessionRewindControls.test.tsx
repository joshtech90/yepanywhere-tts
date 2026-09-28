// @vitest-environment jsdom

import type { SessionRewindRecord } from "@yep-anywhere/shared";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityBus } from "../../lib/activityBus";
import type { Message } from "../../types";
import type { DraftControls } from "../useDraftPersistence";
import {
  type UseSessionRewindControlsOptions,
  useSessionRewindControls,
} from "../useSessionRewindControls";

const { rewindSession, startClearloop, showToast } = vi.hoisted(() => ({
  rewindSession: vi.fn(),
  startClearloop: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { rewindSession, startClearloop },
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToastContext: () => ({ showToast }),
}));
vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function userTurn(uuid: string, extra: Record<string, unknown> = {}): Message {
  return {
    type: "user",
    uuid,
    message: { role: "user", content: `prompt ${uuid}` },
    ...extra,
  } as unknown as Message;
}

function assistantTurn(uuid: string): Message {
  return {
    type: "assistant",
    uuid,
    message: { role: "assistant", content: "reply" },
  } as unknown as Message;
}

const MESSAGES = [
  userTurn("u1"),
  assistantTurn("a1"),
  userTurn("u2"),
  assistantTurn("a2"),
  userTurn("u3"),
];

function record(overrides: Partial<SessionRewindRecord> = {}) {
  return {
    id: "rw-1",
    at: "2026-09-26T00:00:00.000Z",
    cutMessageId: "a1",
    cutTurnIndex: 1,
    droppedTurnCount: 2,
    reason: "clear",
    ...overrides,
  } satisfies SessionRewindRecord;
}

function draftControls() {
  return {
    setDraft: vi.fn(),
    confirmInputClear: vi.fn(),
  } as unknown as DraftControls;
}

function renderControls(overrides: Partial<UseSessionRewindControlsOptions>) {
  const options: UseSessionRewindControlsOptions = {
    projectId: "p1",
    sessionId: "s1",
    messages: MESSAGES,
    supportsRewind: true,
    provider: "claude",
    model: "opus",
    refreshTranscriptTail: vi.fn(async () => {}),
    draftControlsRef: { current: draftControls() },
    recordCommandRecall: vi.fn(),
    createDirectTurnFork: vi.fn(async () => {}),
    ...overrides,
  };
  const location: { current: string } = { current: "" };
  function LocationProbe() {
    const loc = useLocation();
    location.current = `${loc.pathname}${loc.search}`;
    return null;
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/projects/p1/sessions/s1"]}>
      <LocationProbe />
      {children}
    </MemoryRouter>
  );
  const hook = renderHook(() => useSessionRewindControls(options), {
    wrapper,
  });
  return { hook, options, location };
}

describe("useSessionRewindControls", () => {
  beforeEach(() => {
    rewindSession.mockReset();
    startClearloop.mockReset();
    showToast.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes the stable turn index and Clear entries only with rewind support", () => {
    const supported = renderControls({});
    const value = supported.hook.result.current.contextValue;
    expect(value.turnIndexById.get("u3")).toBe(3);
    expect(value.onClearAfter).toBeTypeOf("function");
    expect(value.onClearReplacing).toBeTypeOf("function");

    const unsupported = renderControls({ supportsRewind: false });
    const bare = unsupported.hook.result.current.contextValue;
    expect(bare.turnIndexById.get("u3")).toBe(3);
    expect(bare.onClearAfter).toBeUndefined();
    expect(bare.onClearReplacing).toBeUndefined();
  });

  it("toggles an expanded rewound group", () => {
    const { hook } = renderControls({});
    act(() => hook.result.current.contextValue.toggleRewoundGroup("g1"));
    expect(
      hook.result.current.contextValue.expandedRewoundGroups.has("g1"),
    ).toBe(true);
    act(() => hook.result.current.contextValue.toggleRewoundGroup("g1"));
    expect(
      hook.result.current.contextValue.expandedRewoundGroups.has("g1"),
    ).toBe(false);
  });

  it("runs /clear N as a rewind after turn N and takes the server's projection once", async () => {
    const rewound = record();
    rewindSession.mockResolvedValue({ record: rewound });
    const { hook, options } = renderControls({});

    let consumed = false;
    act(() => {
      consumed = hook.result.current.handleRewindCommand("clear", " 2 ");
    });

    expect(consumed).toBe(true);
    expect(options.recordCommandRecall).toHaveBeenCalledWith("/clear 2");
    expect(
      options.draftControlsRef.current?.confirmInputClear,
    ).toHaveBeenCalled();
    await waitFor(() =>
      expect(options.refreshTranscriptTail).toHaveBeenCalledTimes(1),
    );
    expect(rewindSession).toHaveBeenCalledWith("p1", "s1", {
      cut: { kind: "after-user-turn", sourceMessageId: "u2" },
    });

    // The metadata event echoing this tab's own rewind costs no second fetch.
    act(() => {
      activityBus.emitLocal("session-metadata-changed", {
        type: "session-metadata-changed",
        sessionId: "s1",
        rewindRecord: rewound,
        timestamp: "2026-09-26T00:00:01.000Z",
      });
    });
    expect(options.refreshTranscriptTail).toHaveBeenCalledTimes(1);
  });

  it("hands a malformed command back to the composer without a request", () => {
    const { hook, options } = renderControls({});

    act(() => {
      hook.result.current.handleRewindCommand("clear", "two");
    });

    expect(options.draftControlsRef.current?.setDraft).toHaveBeenCalledWith(
      "/clear two",
    );
    expect(showToast).toHaveBeenCalledWith("rewindCommandSyntax", "error");
    expect(rewindSession).not.toHaveBeenCalled();
    expect(options.recordCommandRecall).not.toHaveBeenCalled();
  });

  it("opens a new session for /clear 0 with the session's provider and model", () => {
    const { hook, location } = renderControls({});

    act(() => {
      hook.result.current.handleRewindCommand("clear", "0");
    });

    expect(location.current).toBe(
      "/new-session?projectId=p1&provider=claude&model=opus",
    );
    expect(rewindSession).not.toHaveBeenCalled();
  });

  it("forks after turn N through the page's fork action", () => {
    const { hook, options } = renderControls({});

    act(() => {
      hook.result.current.handleRewindCommand("fork", "1");
    });

    expect(options.createDirectTurnFork).toHaveBeenCalledWith(
      "u1",
      "after-user-turn",
    );
    expect(rewindSession).not.toHaveBeenCalled();
  });

  it("starts /clearloop from the last live turn when N is omitted", async () => {
    startClearloop.mockResolvedValue({});
    const { hook } = renderControls({});

    act(() => {
      hook.result.current.handleRewindCommand("clearloop", "4: keep going");
    });

    await waitFor(() => expect(startClearloop).toHaveBeenCalled());
    expect(startClearloop).toHaveBeenCalledWith("p1", "s1", {
      cut: { kind: "after-user-turn", sourceMessageId: "u3" },
      prompt: "keep going",
      total: 4,
      commandText: "/clearloop 4: keep going",
    });
  });

  it("takes the server's projection for a rewind recorded or refused elsewhere", () => {
    const { options } = renderControls({});
    const rewound = record();
    const timestamp = "2026-09-26T00:00:01.000Z";
    const emit = (
      data: Partial<{
        sessionId: string;
        rewindRecord: SessionRewindRecord;
        rewindRecordRemoved: string;
      }>,
    ) =>
      act(() => {
        activityBus.emitLocal("session-metadata-changed", {
          type: "session-metadata-changed",
          sessionId: "s1",
          timestamp,
          ...data,
        });
      });

    emit({ sessionId: "other", rewindRecord: rewound });
    expect(options.refreshTranscriptTail).not.toHaveBeenCalled();

    emit({ rewindRecord: rewound });
    emit({ rewindRecord: rewound });
    expect(options.refreshTranscriptTail).toHaveBeenCalledTimes(1);

    // A refused rewind makes its grouped rows live again.
    emit({ rewindRecordRemoved: rewound.id });
    expect(options.refreshTranscriptTail).toHaveBeenCalledTimes(2);
  });
});
