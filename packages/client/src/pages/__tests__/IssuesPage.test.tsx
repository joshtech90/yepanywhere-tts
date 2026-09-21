import type {
  IssueEvidence,
  IssueEvidenceResult,
  IssueSearchResult,
  IssueSession,
  IssueSessionsResult,
} from "@yep-anywhere/shared";
import { DEFAULT_ISSUE_SETTINGS } from "@yep-anywhere/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { IssuesPage } from "../IssuesPage";

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
const runtime = { sourceKey: "localhost", transport: { fetch: state.fetch } };
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useIssuesEnabled", () => ({
  useIssuesEnabled: () => true,
}));
vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));
vi.mock("../../layouts", () => ({
  MainContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useNavigationLayout: () => ({
    openSidebar: () => {},
    isWideScreen: true,
  }),
}));

function evidence(index: number): IssueEvidence {
  return {
    id: index,
    sessionId: "s1",
    projectId: "p1",
    messageId: `m${index}`,
    excerpt: `mention ${index}`,
    value: `AUTOTEST-1 mention ${index}`,
    kind: "text",
    observedAt: index,
    sourceTime: null,
    state: "discovered",
  };
}

const session: IssueSession = {
  sessionId: "s1",
  projectId: "p1",
  title: "Session one",
  state: "discovered",
  evidenceCount: 2,
  // The source is deliberately unavailable so the row renders its plain
  // identity line instead of a full session card.
  sourceAvailable: false,
  evidence: [evidence(1)],
};

function item(index: number) {
  return {
    id: `i${index}`,
    key: `AUTOTEST-${index}`,
    title: `Title ${index}`,
    url: null,
    provider: "jira",
    kind: "issue",
    sessionCount: 1,
    unresolved: false,
  };
}

const search: IssueSearchResult = {
  items: [item(1), item(2)],
  coverage: {
    settings: DEFAULT_ISSUE_SETTINGS,
    active: false,
    error: null,
    counts: [],
  },
  nextOffset: null,
};

const sessions: IssueSessionsResult = { sessions: [session], nextOffset: null };
const evidencePage: IssueEvidenceResult = {
  evidence: [evidence(2)],
  nextOffset: null,
};

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <IssuesPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function selectIssue(index: number) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(`^AUTOTEST-${index}`),
    }),
  );
}

async function expandFirstIssueSession() {
  await selectIssue(1);
  fireEvent.click(
    await screen.findByRole("button", { name: /more mentions/i }),
  );
  expect(await screen.findByText("mention 2")).toBeTruthy();
}

describe("IssuesPage associated sessions", () => {
  beforeEach(() => {
    state.fetch.mockReset();
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions")) return Promise.resolve(sessions);
      if (path.startsWith("/issues/evidence"))
        return Promise.resolve(evidencePage);
      return Promise.resolve(search);
    });
  });
  afterEach(cleanup);

  it("keeps an expanded row's loaded mentions across a refresh", async () => {
    renderPage();
    await expandFirstIssueSession();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      await screen.findByRole("button", { name: /fewer mentions/i }),
    ).toBeTruthy();
    expect(screen.getByText("mention 2")).toBeTruthy();
  });

  it("shows a refreshed first mention below the ones already loaded", async () => {
    renderPage();
    await expandFirstIssueSession();

    const renamed = { ...evidence(1), excerpt: "mention 1 (edited)" };
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions"))
        return Promise.resolve({
          sessions: [{ ...session, evidence: [renamed] }],
          nextOffset: null,
        });
      if (path.startsWith("/issues/evidence"))
        return Promise.resolve(evidencePage);
      return Promise.resolve(search);
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("mention 1 (edited)")).toBeTruthy();
    expect(screen.getByText("mention 2")).toBeTruthy();
  });

  it("empties the pane when another issue is picked", async () => {
    renderPage();
    await expandFirstIssueSession();

    let answerSessions: (result: IssueSessionsResult) => void = () => {};
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions"))
        return new Promise<IssueSessionsResult>((resolve) => {
          answerSessions = resolve;
        });
      return Promise.resolve(search);
    });
    await selectIssue(2);

    expect(await screen.findByText("Loading sessions…")).toBeTruthy();
    expect(screen.queryByText("mention 2")).toBeNull();
    answerSessions({ sessions: [], nextOffset: null });
  });
});
