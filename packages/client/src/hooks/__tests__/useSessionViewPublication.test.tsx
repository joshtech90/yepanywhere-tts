// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCurrentSessionViewer,
  minimizeSessionViewer,
  presentSessionViewer,
} from "../../lib/sessionViewerController";
import type { ProjectAppView } from "../../lib/sessionViewPublication";
import { useSessionViewPublication } from "../useSessionViewPublication";

const { publishSessionView, departSessionView, capabilities } = vi.hoisted(
  () => ({
    publishSessionView: vi.fn(),
    departSessionView: vi.fn(),
    capabilities: { current: [] as string[] },
  }),
);

vi.mock("../../api/client", () => ({
  api: { publishSessionView, departSessionView },
}));

vi.mock("../useVersion", () => ({
  useVersion: () => ({ version: { capabilities: capabilities.current } }),
}));

function Harness({
  sessionId = "s1",
  active = true,
  projectApp = null,
}: {
  sessionId?: string;
  active?: boolean;
  projectApp?: ProjectAppView | null;
}) {
  useSessionViewPublication(sessionId, active, projectApp);
  return null;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  capabilities.current = ["agent-session-view"];
  publishSessionView.mockResolvedValue({ ok: true });
  departSessionView.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  clearCurrentSessionViewer();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useSessionViewPublication", () => {
  it("reports nothing to a server that does not collect views", async () => {
    capabilities.current = [];
    render(<Harness />);
    await settle();
    expect(publishSessionView).not.toHaveBeenCalled();
  });

  it("reports the session's viewer without bearer queries, once per change", async () => {
    const { unmount } = render(<Harness />);
    await settle();
    expect(publishSessionView).toHaveBeenLastCalledWith(
      "s1",
      expect.objectContaining({ viewers: [], focused: expect.any(Boolean) }),
    );
    act(() => {
      presentSessionViewer({
        id: "vhost:s1:a",
        kind: "vhost",
        sessionId: "s1",
        label: "review",
        url: "https://review.example.test/plan?ya_access=secret#top",
        sourceUrl: "http://localhost:19432/plan?x=1",
        openedBy: "session",
      });
    });
    await settle();
    expect(publishSessionView).toHaveBeenLastCalledWith(
      "s1",
      expect.objectContaining({
        viewers: [
          {
            kind: "app",
            label: "review",
            target: "http://localhost:19432/plan",
            url: "https://review.example.test/plan",
            openedBy: "session",
            state: "open",
            placement: "right-pane",
          },
        ],
      }),
    );
    const calls = publishSessionView.mock.calls.length;
    act(() => minimizeSessionViewer("vhost:s1:a"));
    await settle();
    expect(publishSessionView).toHaveBeenCalledTimes(calls + 1);
    expect(publishSessionView.mock.lastCall?.[1].viewers[0].state).toBe(
      "minimized",
    );
    await settle();
    expect(publishSessionView).toHaveBeenCalledTimes(calls + 1);
    const clientId = publishSessionView.mock.lastCall?.[1].clientId;
    unmount();
    await settle();
    expect(departSessionView).toHaveBeenCalledWith("s1", clientId);
  });

  it("ignores another session's viewer and reports the project app", async () => {
    const { rerender } = render(<Harness />);
    act(() => {
      presentSessionViewer({
        id: "file:s2",
        kind: "file",
        sessionId: "s2",
        label: "a.ts",
        filePath: "src/a.ts",
        lineSuffix: ":3",
        onClose: () => {},
      });
    });
    await settle();
    expect(publishSessionView.mock.lastCall?.[1].viewers).toEqual([]);
    rerender(
      <Harness
        projectApp={{ target: undefined, full: true, openedBy: "user" }}
      />,
    );
    await settle();
    expect(publishSessionView.mock.lastCall?.[1].viewers).toEqual([
      {
        kind: "project-app",
        label: "Project app",
        target: "app",
        openedBy: "user",
        state: "open",
        placement: "full-view",
      },
    ]);
  });
});
