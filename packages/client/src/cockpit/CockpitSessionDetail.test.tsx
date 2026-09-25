import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitSessionDetail } from "./CockpitSessionDetail";
import type { CockpitSessionDetailData } from "./useCockpitSessionDetail";

const detailMocks = vi.hoisted(() => ({
  data: null as CockpitSessionDetailData | null,
  sourceKey: "local",
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ sourceKey: detailMocks.sourceKey }),
}));

vi.mock("./useCockpitSessionDetail", () => ({
  useCockpitSessionDetail: () => detailMocks.data,
}));

vi.mock("./CockpitComposer", () => ({
  CockpitComposer: () => <div data-testid="cockpit-composer" />,
}));

vi.mock("./CockpitModelControls", () => ({
  CockpitModelControls: () => <button type="button">Model controls</button>,
}));

function detailData(
  overrides: Partial<CockpitSessionDetailData> = {},
): CockpitSessionDetailData {
  return {
    attention: {
      interruptible: false,
      request: null,
      respond: vi.fn(async () => ({ kind: "accepted" as const })),
      stop: vi.fn(async () => ({ kind: "accepted" as const })),
    },
    composer: {
      actualSessionId: "session-1",
      addPendingMessage: vi.fn(() => ({ tempId: "temp-1" })),
      permissionMode: "default",
      processState: "idle",
      reconnectStream: vi.fn(),
      removePendingMessage: vi.fn(),
      session: null,
      setDeferredMessages: vi.fn(),
      setProcessState: vi.fn(),
      setStatus: vi.fn(),
      status: { owner: "none" },
    },
    entries: [
      {
        kind: "user",
        key: "local-user-1",
        text: "Prepare the release summary.",
        timestamp: "2026-09-24T09:00:00.000Z",
      },
      {
        kind: "assistant",
        key: "local-assistant-1",
        text: [
          {
            id: "text-1",
            text: "### Release summary\n\nEverything is ready.",
            augmentHtml:
              "<h3>Release summary</h3><p>Everything is ready.</p>",
            isStreaming: false,
            abortedMidStream: false,
          },
        ],
        thinking: [
          {
            id: "thinking-1",
            text: "Check the evidence before summarizing.",
            status: "complete",
          },
        ],
        spokenText: "Release summary. Everything is ready.",
        isStreaming: false,
        timestamp: "2026-09-24T09:00:01.000Z",
      },
    ],
    error: null,
    hasOlderMessages: true,
    loadOlderMessages: vi.fn(async () => {}),
    loading: false,
    loadingOlder: false,
    processState: "idle",
    reloadSession: vi.fn(),
    restoredFromSnapshot: true,
    session: {
      id: "session-1",
      projectId: "project-1" as UrlProjectId,
      projectName: "Atlas",
      title: "Release summary",
      fullTitle: "Release summary",
      createdAt: "2026-09-24T09:00:00.000Z",
      updatedAt: "2026-09-24T09:00:01.000Z",
      messageCount: 2,
      ownership: { owner: "none" },
      provider: "claude",
      model: "claude-sonnet-4-5",
    },
    sessionUpdatesConnected: false,
    sessionUpdatesResubscribing: false,
    setSessionModel: vi.fn(),
    status: { owner: "none" },
    ...overrides,
  };
}

function detailTree() {
  return (
    <MemoryRouter
      initialEntries={[
        "/cockpit/projects/project-1/sessions/session-1",
      ]}
    >
      <I18nProvider>
        <CockpitSessionDetail
          basePath=""
          projectId="project-1"
          sessionId="session-1"
          shellKind="empty"
        />
      </I18nProvider>
    </MemoryRouter>
  );
}

function renderDetail() {
  return render(detailTree());
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  detailMocks.sourceKey = "local";
  detailMocks.data = detailData();
});

describe("Cockpit session detail", () => {
  it("renders a quiet read-only conversation with the shared read-aloud entry", () => {
    renderDetail();

    expect(
      screen.getByRole("heading", { name: "Release summary", level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Release summary", level: 3 }),
    ).toBeTruthy();
    expect(screen.getByText("Prepare the release summary.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Read response aloud" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy response" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy prompt" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open in existing view" })
        .getAttribute("href"),
    ).toBe("/projects/project-1/sessions/session-1");
  });

  it("loads older history through the canonical session action", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(detailMocks.data?.loadOlderMessages).toHaveBeenCalledTimes(1);
  });

  it("anchors only a real history prepend when a live row arrives during loading", async () => {
    let finishLoading = () => {};
    const loadOlderMessages = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLoading = resolve;
        }),
    );
    const initial = detailData({ loadOlderMessages });
    detailMocks.data = initial;
    const view = renderDetail();
    const transcript = screen.getByLabelText("Session conversation");
    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      get: () => (detailMocks.data?.entries.length ?? 0) * 100,
    });
    const anchor = transcript.querySelector<HTMLElement>(
      '[data-cockpit-entry-key="local-user-1"]',
    );
    if (!anchor) throw new Error("missing transcript anchor fixture");
    anchor.getBoundingClientRect = () => {
      const anchorIndex =
        detailMocks.data?.entries.findIndex(
          (entry) => entry.key === "local-user-1",
        ) ?? 0;
      return {
        bottom: (anchorIndex + 1) * 100,
        height: 100,
        left: 0,
        right: 100,
        top: anchorIndex * 100,
        width: 100,
        x: 0,
        y: anchorIndex * 100,
        toJSON: () => ({}),
      };
    };
    transcript.scrollTop = 40;

    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));

    const liveTail = {
      kind: "user" as const,
      key: "live-tail",
      text: "A live update arrived.",
      timestamp: "2026-09-24T09:00:02.000Z",
    };
    detailMocks.data = {
      ...initial,
      entries: [...initial.entries, liveTail],
    };
    view.rerender(detailTree());
    expect(transcript.scrollTop).toBe(40);

    const older = {
      kind: "user" as const,
      key: "older-user",
      text: "An older message.",
      timestamp: "2026-09-24T08:59:00.000Z",
    };
    detailMocks.data = {
      ...initial,
      entries: [older, ...initial.entries, liveTail],
    };
    view.rerender(detailTree());
    expect(transcript.scrollTop).toBe(140);

    await act(async () => {
      finishLoading();
      await Promise.resolve();
    });
  });

  it("keeps retained content visible while reconnecting", () => {
    detailMocks.data = detailData({
      processState: "in-turn",
      sessionUpdatesConnected: false,
      sessionUpdatesResubscribing: true,
      status: { owner: "self", processId: "process-1" },
    });
    renderDetail();

    expect(screen.getByText("Reconnecting")).toBeTruthy();
    expect(screen.getByText("Everything is ready.")).toBeTruthy();
  });

  it("clears local approval answers when the source identity changes", () => {
    const request = {
      id: "shared-request",
      sessionId: "session-1",
      type: "question" as const,
      prompt: "Add a fictional review note.",
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          {
            id: "note",
            header: "Review note",
            question: "What should the note say?",
            isOther: true,
            options: [],
          },
        ],
      },
      timestamp: "2026-09-24T09:00:03.000Z",
    };
    detailMocks.data = detailData({
      attention: {
        interruptible: true,
        request,
        respond: vi.fn(async () => ({ kind: "accepted" as const })),
        stop: vi.fn(async () => ({ kind: "accepted" as const })),
      },
      processState: "waiting-input",
      status: { owner: "self", processId: "shared-process" },
    });
    const view = renderDetail();
    const answer = screen.getByRole("textbox", {
      name: "Review note: Write another answer",
    });
    fireEvent.change(answer, { target: { value: "Old source answer" } });
    expect((answer as HTMLInputElement).value).toBe("Old source answer");

    detailMocks.sourceKey = "relay:studio";
    view.rerender(detailTree());

    expect(
      (
        screen.getByRole("textbox", {
          name: "Review note: Write another answer",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("clears local stop feedback when the session context changes", async () => {
    const stop = vi.fn(async () => ({ kind: "accepted" as const }));
    detailMocks.data = detailData({
      attention: {
        interruptible: true,
        request: null,
        respond: vi.fn(async () => ({ kind: "accepted" as const })),
        stop,
      },
      processState: "in-turn",
      status: { owner: "self", processId: "shared-process" },
    });
    const view = renderDetail();
    fireEvent.click(
      screen.getByRole("button", { name: "Stop current turn" }),
    );
    expect(await screen.findByText("Stop requested")).toBeTruthy();

    detailMocks.sourceKey = "relay:studio";
    view.rerender(detailTree());

    expect(screen.queryByText("Stop requested")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Stop current turn" }),
    ).toBeTruthy();
  });

  it("keeps a pending approval visible while session updates reconnect", () => {
    detailMocks.data = detailData({
      attention: {
        interruptible: true,
        request: {
          id: "approval-1",
          sessionId: "session-1",
          type: "tool-approval",
          prompt: "Allow the invented formatting command?",
          toolName: "Bash",
          toolInput: { command: "printf demo" },
          timestamp: "2026-09-24T09:00:02.000Z",
        },
        respond: vi.fn(async () => ({ kind: "accepted" as const })),
        stop: vi.fn(async () => ({ kind: "accepted" as const })),
      },
      processState: "waiting-input",
      sessionUpdatesConnected: false,
      sessionUpdatesResubscribing: true,
      status: { owner: "self", processId: "process-1" },
    });
    renderDetail();

    expect(
      screen.getByRole("heading", { name: "Review this action" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Stop current turn" }),
    ).toBeTruthy();
  });

  it("offers one server-authoritative stop request during rapid clicks", () => {
    const stop = vi.fn(
      () =>
        new Promise<{ kind: "accepted" }>(() => {
          // Keep the first request pending while the second click is attempted.
        }),
    );
    detailMocks.data = detailData({
      attention: {
        interruptible: true,
        request: null,
        respond: vi.fn(async () => ({ kind: "accepted" as const })),
        stop,
      },
      processState: "in-turn",
      status: { owner: "self", processId: "process-1" },
    });
    renderDetail();

    const stopButton = screen.getByRole("button", {
      name: "Stop current turn",
    });
    fireEvent.click(stopButton);
    fireEvent.click(stopButton);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stopButton.getAttribute("data-cockpit-shortcut")).toBe("stop");
    expect(stopButton.getAttribute("aria-keyshortcuts")).toBe("Escape");
  });

  it("keeps Stop and the pending action card reachable through parent updates", () => {
    const initial = detailData({
      attention: {
        interruptible: true,
        request: {
          id: "request-1",
          sessionId: "session-1",
          type: "tool-approval",
          prompt: "Allow the fictional tool?",
          toolName: "UnfamiliarTool",
          toolInput: { task: "Check the fictional preview." },
          timestamp: "2026-09-25T01:00:00.000Z",
        },
        respond: vi.fn(async () => ({ kind: "accepted" as const })),
        stop: vi.fn(async () => ({ kind: "accepted" as const })),
      },
      processState: "waiting-input",
      status: { owner: "self", processId: "process-1" },
    });
    detailMocks.data = initial;
    const view = renderDetail();

    for (let update = 0; update < 5; update += 1) {
      detailMocks.data = {
        ...initial,
        entries: [...initial.entries],
      };
      view.rerender(detailTree());
    }

    expect(
      screen.getByRole("button", { name: "Stop current turn" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Review this action" }),
    ).toBeTruthy();
  });

  it("defers storming transcript tails while the direct stop action stays immediate", async () => {
    const stop = vi.fn(async () => ({ kind: "accepted" as const }));
    const initial = detailData({
      attention: {
        interruptible: true,
        request: null,
        respond: vi.fn(async () => ({ kind: "accepted" as const })),
        stop,
      },
      processState: "in-turn",
      sessionUpdatesConnected: true,
      status: { owner: "self", processId: "storm-process" },
    });
    detailMocks.data = initial;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(detailTree()));
    const stopButton = screen.getByRole("button", {
      name: "Stop current turn",
    });
    stopButton.focus();

    const storm: CockpitSessionDetailData = {
      ...initial,
      entries: [
        ...initial.entries,
        {
          kind: "user",
          key: "storm-tail",
          text: "Invented storm update",
        },
      ],
    };
    detailMocks.data = storm;
    act(() => {
      flushSync(() => root.render(detailTree()));
      expect(screen.queryByText("Invented storm update")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Stop current turn" }),
      ).toBe(stopButton);
      expect(document.activeElement).toBe(stopButton);
      fireEvent.click(stopButton);
    });

    await screen.findByText("Stop requested");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Invented storm update")).toBeTruthy();

    detailMocks.data = {
      ...storm,
      entries: [
        {
          kind: "user",
          key: "older-prefix",
          text: "Invented older update",
        },
        ...storm.entries,
      ],
    };
    act(() => {
      flushSync(() => root.render(detailTree()));
      expect(screen.getByText("Invented older update")).toBeTruthy();
    });

    act(() => root.unmount());
    host.remove();
  });
});
