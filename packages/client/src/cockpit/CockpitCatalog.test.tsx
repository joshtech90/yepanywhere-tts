import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { CockpitCatalog } from "./CockpitCatalog";
import type { CockpitCatalogView } from "./core/catalog";
import { createCockpitNavigation } from "./core/navigation";
import { useCockpitShortcuts } from "./useCockpitShortcuts";
import type { CockpitOrganizationController } from "./useCockpitOrganization";

afterEach(cleanup);

function catalogWithSessions(count: number): CockpitCatalogView {
  return {
    sourceKey: "local",
    sessionCount: count,
    projects: [
      {
        key: "local-project-atlas",
        id: "atlas",
        name: "Atlas",
        path: "/work/atlas",
        lastActivityAt: "2026-09-24T12:00:00.000Z",
        sessions: Array.from({ length: count }, (_, index) => ({
          key: `local-session-${index}`,
          id: `session-${index}`,
          projectId: "atlas",
          title: index === 0 ? "Release checklist" : `Fixture session ${index}`,
          provider: "claude",
          lastActivityAt: "2026-09-24T12:00:00.000Z",
          pinned: index === 0,
          status: index === 0 ? "active" : "complete",
        })),
      },
    ],
  };
}

function organization(): CockpitOrganizationController {
  return {
    activeViewId: null,
    pinError: false,
    pinnedOnly: false,
    pendingPins: new Set(),
    views: [],
    activateView: vi.fn(),
    clearActiveView: vi.fn(),
    removeView: vi.fn(),
    saveView: vi.fn(),
    setPinnedOnly: vi.fn(),
    togglePin: vi.fn(async () => true),
    renameSession: vi.fn(async () => true),
    archiveSession: vi.fn(async () => true),
    unarchiveSession: vi.fn(async () => true),
  };
}

function ShortcutPage({
  children,
  onStop,
}: {
  children: ReactNode;
  onStop: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  useCockpitShortcuts({
    drawerOpen: false,
    navigation: createCockpitNavigation(""),
    onCloseDrawer: vi.fn(),
    onCloseHelp: vi.fn(),
    onCloseSearch: vi.fn(),
    onOpenHelp: vi.fn(),
    onOpenSearch: vi.fn(),
    rootRef,
    searchOpen: false,
    shortcutsOpen: false,
  });
  return (
    <main ref={rootRef}>
      {children}
      <button data-cockpit-shortcut="stop" onClick={onStop} type="button">
        Stop
      </button>
    </main>
  );
}

function CatalogHarness({
  catalog,
  onStop,
  organizationController = organization(),
  path = "/cockpit",
}: {
  catalog: CockpitCatalogView;
  /** Mounts the page shortcuts with a running session's Stop button. */
  onStop?: () => void;
  organizationController?: CockpitOrganizationController;
  path?: string;
}) {
  const [query, setQuery] = useState("");
  const catalogView = (
    <CockpitCatalog
      basePath=""
      catalog={catalog}
      error={null}
      hasMore={false}
      loading={false}
      onLoadMore={vi.fn(async () => {})}
      onQueryChange={setQuery}
      organization={organizationController}
      query={query}
    />
  );
  const catalogElement = onStop ? (
    <ShortcutPage onStop={onStop}>{catalogView}</ShortcutPage>
  ) : (
    catalogView
  );
  return (
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <Routes>
          <Route path="/cockpit" element={catalogElement} />
          <Route
            path="/cockpit/projects/:projectId/sessions/:sessionId"
            element={catalogElement}
          />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("Cockpit catalog", () => {
  it("clears the sidebar filter on Escape without stopping the open session", () => {
    const onStop = vi.fn();
    render(<CatalogHarness catalog={catalogWithSessions(3)} onStop={onStop} />);
    const input = screen.getByRole("searchbox", {
      name: "Sessions",
    }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Release" } });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onStop).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    expect(screen.getByText("Fixture session 2")).toBeTruthy();
  });

  it("keeps the search draft while summary updates arrive", () => {
    let catalog = catalogWithSessions(30);
    const { rerender } = render(<CatalogHarness catalog={catalog} />);
    let input = screen.getByRole("searchbox", {
      name: "Sessions",
    }) as HTMLInputElement;
    let value = "";

    for (const character of "Atlas") {
      value += character;
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);

      catalog = catalogWithSessions(catalog.sessionCount + 1);
      rerender(<CatalogHarness catalog={catalog} />);
      input = screen.getByRole("searchbox", {
        name: "Sessions",
      }) as HTMLInputElement;
      expect(input.value).toBe(value);
    }

    expect(screen.getByText("Release checklist")).toBeTruthy();
    expect(
      screen.getByText("Release checklist").closest("a")?.getAttribute("href"),
    ).toBe("/cockpit/projects/atlas/sessions/session-0");
    expect(document.querySelector("time")?.getAttribute("title")).toContain(
      "2026",
    );
  });

  it("leads with favourites under one star, then every session by time", () => {
    render(<CatalogHarness catalog={catalogWithSessions(3)} />);

    const favorites = screen.getByRole("region", { name: "Favorites" });
    expect(favorites.textContent).toContain("Release checklist");
    expect(favorites.textContent).not.toContain("Fixture session 1");
    expect(favorites.querySelectorAll("svg:not([data-brand])")).toHaveLength(1);
    // Every row names its provider by logo and in its accessible name.
    expect(favorites.querySelector('svg[data-brand="claude"]')).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /Release checklist, Claude,/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /favorites/i })).toBeNull();
    const others = screen.getByRole("list", { name: "All sessions" });
    expect(others.textContent).toContain("Fixture session 1");
    expect(others.textContent).toContain("Atlas");
    expect(screen.getByRole("img", { name: "Working" })).toBeTruthy();
    expect(screen.queryByText("Finished")).toBeNull();
  });

  it("offers favourite, rename and archive from the context menu", async () => {
    const controller = organization();
    render(
      <CatalogHarness
        catalog={catalogWithSessions(2)}
        organizationController={controller}
      />,
    );

    fireEvent.contextMenu(
      screen.getByText("Release checklist").closest("a") as HTMLElement,
      { clientX: 40, clientY: 50 },
    );
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Remove from favorites", "Rename", "Hide"]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from favorites" }),
    );
    expect(controller.togglePin).toHaveBeenCalledWith("session-0", false);

    fireEvent.contextMenu(
      screen.getByText("Fixture session 1").closest("a") as HTMLElement,
      { clientX: 40, clientY: 90 },
    );
    // An idle session hides at once; only a working one asks first.
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    await vi.waitFor(() =>
      expect(controller.archiveSession).toHaveBeenCalledWith("session-1"),
    );

    fireEvent.contextMenu(
      screen.getByText("Release checklist").closest("a") as HTMLElement,
      { clientX: 40, clientY: 50 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(controller.archiveSession).not.toHaveBeenCalledWith("session-0");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await vi.waitFor(() =>
      expect(controller.archiveSession).toHaveBeenCalledWith("session-0"),
    );
  });

  it("marks the open session like a hovered row", () => {
    render(
      <CatalogHarness
        catalog={catalogWithSessions(3)}
        path="/cockpit/projects/atlas/sessions/session-1"
      />,
    );

    const open = screen.getByText("Fixture session 1").closest("a");
    expect(open?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(
      screen
        .getByText("Release checklist")
        .closest("a")
        ?.getAttribute("aria-current"),
    ).toBeNull();
  });
});
