import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitProjectsView } from "./CockpitListViews";

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
