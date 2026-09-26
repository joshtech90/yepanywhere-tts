import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => {}),
  startSession: vi.fn(async () => ({
    projectId: "project-1",
    sessionId: "new-session",
    processId: "process-2",
    permissionMode: "default",
    modeVersion: 1,
  })),
  navigate: vi.fn(),
}));

vi.mock("./cockpitSend", () => ({ sendCockpitDirectMessage: mocks.send }));
vi.mock("../api/client", () => ({
  api: { startSession: mocks.startSession },
}));
vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ sourceKey: "local", transport: {} }),
}));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));

import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { COCKPIT_HANDOFF_PROMPT } from "./core/handoff";
import type { CockpitLaunchChoices } from "./core/newSession";
import type { CockpitTranscriptEntry } from "./core/sessionDetail";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";
import { useCockpitHandoff } from "./useCockpitHandoff";

function port(
  processState: CockpitComposerSessionPort["processState"],
): CockpitComposerSessionPort {
  return {
    actualSessionId: "session-1",
    addPendingMessage: vi.fn(() => ({ tempId: "temp-1" })),
    permissionMode: "bypassPermissions",
    processState,
    reconnectStream: vi.fn(),
    removePendingMessage: vi.fn(),
    session: null,
    setDeferredMessages: vi.fn(),
    setProcessState: vi.fn(),
    setStatus: vi.fn(),
    status: { owner: "none" },
  } as CockpitComposerSessionPort;
}

const choices = {
  models: [],
  modelInfo: null,
  effortOptions: [],
  thinkingModes: ["off"],
  permissionModes: ["default", "bypassPermissions"],
  supportsPermissionMode: true,
  supportsThinking: false,
  effective: {
    provider: "claude",
    model: "claude-haiku",
    thinkingMode: "off",
    effortLevel: "medium",
    permissionMode: "default",
  },
} as unknown as CockpitLaunchChoices;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>{children}</I18nProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  mocks.send.mockClear();
  mocks.startSession.mockClear();
  mocks.navigate.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("useCockpitHandoff", () => {
  it("asks the session for a handoff, then starts a new session with it", async () => {
    let props = {
      basePath: "",
      entries: [] as CockpitTranscriptEntry[],
      port: port("idle"),
      projectId: "project-1",
      sourceTitle: "Gboard APK patchen",
    };
    const { result, rerender } = renderHook(() => useCockpitHandoff(props), {
      wrapper,
    });

    await act(() => result.current.start(choices));
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: COCKPIT_HANDOFF_PROMPT }),
    );
    expect(result.current.phase).toBe("summarizing");

    props = { ...props, port: port("in-turn") };
    rerender();
    expect(mocks.startSession).not.toHaveBeenCalled();

    props = {
      ...props,
      port: port("idle"),
      entries: [
        { kind: "user", key: "u", text: COCKPIT_HANDOFF_PROMPT },
        {
          kind: "assistant",
          key: "a",
          text: [
            {
              id: "t",
              text: "1. Ziel: Tastatur",
              isStreaming: false,
              abortedMidStream: false,
            },
          ],
          thinking: [],
          spokenText: "1. Ziel: Tastatur",
          isStreaming: false,
        },
      ],
    };
    await act(async () => {
      rerender();
    });

    expect(mocks.startSession).toHaveBeenCalledTimes(1);
    const [projectId, message, options] = mocks.startSession.mock
      .calls[0] as unknown as [string, string, { model?: string; mode?: string }];
    expect(projectId).toBe("project-1");
    expect(message).toContain("„Gboard APK patchen“");
    expect(message).toContain("1. Ziel: Tastatur");
    expect(options.model).toBe("claude-haiku");
    expect(options.mode).toBe("bypassPermissions");
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        "/cockpit/projects/project-1/sessions/new-session",
        expect.anything(),
      ),
    );
  });

  it("reports a turn that ends without a handoff after a grace period", async () => {
    vi.useFakeTimers();
    let props = {
      basePath: "",
      entries: [] as CockpitTranscriptEntry[],
      port: port("idle"),
      projectId: "project-1",
      sourceTitle: "Test",
    };
    const { result, rerender } = renderHook(() => useCockpitHandoff(props), {
      wrapper,
    });
    await act(() => result.current.start(choices));
    props = { ...props, port: port("in-turn") };
    rerender();
    props = { ...props, port: port("idle") };
    await act(async () => {
      rerender();
    });

    // The answer may still be on its way into the transcript.
    expect(result.current.phase).toBe("summarizing");
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.phase).toBe("error");
    expect(mocks.startSession).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("refuses to write into a session another program is driving", async () => {
    const external = {
      ...port("idle"),
      status: { owner: "external" },
    } as CockpitComposerSessionPort;
    const { result } = renderHook(
      () =>
        useCockpitHandoff({
          basePath: "",
          entries: [],
          port: external,
          projectId: "project-1",
          sourceTitle: "Test",
        }),
      { wrapper },
    );

    await act(() => result.current.start(choices));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("error");
  });

  it("starts only once when clicked twice", async () => {
    const { result } = renderHook(
      () =>
        useCockpitHandoff({
          basePath: "",
          entries: [],
          port: port("idle"),
          projectId: "project-1",
          sourceTitle: "Test",
        }),
      { wrapper },
    );
    await act(async () => {
      void result.current.start(choices);
      void result.current.start(choices);
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
