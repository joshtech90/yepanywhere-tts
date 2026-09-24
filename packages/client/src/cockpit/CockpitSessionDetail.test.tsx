import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitSessionDetail } from "./CockpitSessionDetail";
import type { CockpitSessionDetailData } from "./useCockpitSessionDetail";

const detailMocks = vi.hoisted(() => ({
  data: null as CockpitSessionDetailData | null,
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

function renderDetail() {
  return render(
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
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
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
});
