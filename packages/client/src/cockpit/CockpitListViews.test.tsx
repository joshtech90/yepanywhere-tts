import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitProjectsView, CockpitSessionsView } from "./CockpitListViews";
import type { CockpitOrganizationController } from "./useCockpitOrganization";

vi.mock("../hooks/useProjects", () => ({
  useProjects: () => ({
    loading: false,
    error: null,
    refetch: vi.fn(),
    projects: [
      {
        id: "atlas",
        name: "Atlas",
        path: "/work/atlas",
        sessionCount: 4,
        activeOwnedCount: 0,
        activeExternalCount: 1,
        lastActivity: "2026-09-24T12:00:00.000Z",
      },
      {
        id: "fern",
        name: "Fern",
        path: "/work/fern",
        sessionCount: 1,
        activeOwnedCount: 0,
        activeExternalCount: 0,
        lastActivity: "2026-09-20T12:00:00.000Z",
      },
    ],
  }),
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ sourceKey: "local" }),
}));

vi.mock("../hooks/useGlobalSessionsFeed", () => ({
  useGlobalSessionsFeed: () => ({
    query: "cockpit-test",
    error: null,
    loading: false,
    hasMore: false,
    loadMore: vi.fn(async () => {}),
  }),
}));

vi.mock("../lib/clientSummaryStore", () => ({
  useClientSummaryState: () => ({
    providerRuntime: { bySessionId: new Map() },
  }),
  useSessionCollectionQueryRecords: () => [
    {
      id: "recent",
      projectId: "atlas",
      title: "Recent work",
      provider: "claude",
      updatedAt: "2026-09-30T12:00:00.000Z",
      ownership: { owner: "none" },
    },
    {
      id: "starred",
      projectId: "fern",
      title: "Starred plan",
      provider: "claude",
      isStarred: true,
      updatedAt: "2026-09-01T12:00:00.000Z",
      ownership: { owner: "none" },
    },
  ],
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
});

function renderProjects() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CockpitProjectsView basePath="" />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Cockpit projects view", () => {
  it("lists projects inside the Cockpit, most recent first", () => {
    renderProjects();

    const links = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("view=sessions"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/cockpit?view=sessions&project=atlas",
      "/cockpit?view=sessions&project=fern",
    ]);
    expect(screen.getByRole("img", { name: "Working" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "New session in Atlas" })
        .getAttribute("href"),
    ).toBe("/cockpit?view=new&project=atlas");
  });

  it("filters by name or path", () => {
    renderProjects();

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter" }), {
      target: { value: "fern" },
    });

    expect(screen.queryByText("Atlas")).toBeNull();
    expect(screen.getByText("Fern")).toBeTruthy();
  });
});

describe("Cockpit sessions view", () => {
  it("leads with favourites, as the sidebar does", () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <CockpitSessionsView
            basePath=""
            organization={{} as CockpitOrganizationController}
            projectId={null}
            shellKind="empty"
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const favorites = screen.getByRole("region", { name: "Favorites" });
    expect(favorites.textContent).toContain("Starred plan");
    expect(favorites.textContent).not.toContain("Recent work");
    expect(screen.getByText("Recent work")).toBeTruthy();
  });
});
