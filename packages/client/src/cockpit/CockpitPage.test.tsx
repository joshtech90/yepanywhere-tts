import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { useCockpitDrawerOpener } from "./CockpitMobileDrawer";
import { CockpitPage, CockpitShell } from "./CockpitPage";
import { readCockpitReturn } from "./core/navigation";
import type { CockpitShellState } from "./core/shellState";
import type { CockpitCatalogData } from "./useCockpitCatalog";

const pageMocks = vi.hoisted(() => {
  const getSnapshot = vi.fn(() => ({
    kind: "secure",
    state: "ready" as const,
    channels: [],
  }));
  const subscribe = vi.fn(() => () => {});
  return {
    getSnapshot,
    subscribe,
    runtime: {
      sourceKey: "local",
      transport: { status: { getSnapshot, subscribe } },
    },
    catalogData: {
      catalog: { sourceKey: "local", projects: [], sessionCount: 0 },
      error: null,
      loading: false,
      hasMore: false,
      loadMore: vi.fn(async () => {}),
      organization: {
        activeViewId: null,
        pinError: false,
        pinnedOnly: false,
        pendingPins: new Set<string>(),
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
      },
    },
  };
});

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => pageMocks.runtime,
}));

vi.mock("../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

vi.mock("./useCockpitAppearance", () => ({
  useCockpitAppearance: () => ({
    accent: "blue",
    theme: "auto",
    resolvedTheme: "light",
    setAccent: vi.fn(),
    setTheme: vi.fn(),
  }),
}));

vi.mock("./useCockpitCatalog", () => ({
  useCockpitCatalog: () => pageMocks.catalogData,
}));

vi.mock("./useCockpitSearch", () => ({
  useCockpitSearch: () => ({
    results: [],
    support: "title-only",
    loadedSessionCount: 0,
    catalogLoading: false,
    catalogHasMore: false,
    contentRunning: false,
    partialSessions: [],
    unsupportedProviderSessionCount: 0,
    error: null,
  }),
}));

vi.mock("./CockpitCodexUpdateNotice", () => ({
  CockpitCodexUpdateNotice: () => null,
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  pageMocks.runtime.sourceKey = "local";
});

function DrawerProbe() {
  const openDrawer = useCockpitDrawerOpener();
  return openDrawer ? (
    <button onClick={openDrawer} type="button">
      Open drawer
    </button>
  ) : null;
}

function mockPhoneLayout() {
  const original = window.matchMedia;
  window.matchMedia = ((media: string) => ({
    ...original(media),
    matches: media === "(max-width: 700px)",
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function renderShell(shellState: CockpitShellState = { kind: "empty" }) {
  const onAccentChange = vi.fn();
  const onThemeChange = vi.fn();
  render(
    <MemoryRouter initialEntries={["/-/relay/studio/cockpit"]}>
      <I18nProvider>
        <CockpitShell
          accent="blue"
          basePath="/-/relay/studio/"
          catalogData={pageMocks.catalogData as CockpitCatalogData}
          onAccentChange={onAccentChange}
          onThemeChange={onThemeChange}
          resolvedTheme="light"
          shellState={shellState}
          theme="auto"
        />
      </I18nProvider>
    </MemoryRouter>,
  );
  return { onAccentChange, onThemeChange };
}

describe("Cockpit shell", () => {
  it("opens a drawer with navigation and sessions from a phone session", () => {
    const restore = mockPhoneLayout();
    try {
      sessionStorage.clear();
      render(
        <MemoryRouter
          initialEntries={["/cockpit/projects/p/sessions/s?keep=1"]}
        >
          <I18nProvider>
            <CockpitShell
              accent="blue"
              basePath=""
              catalogData={pageMocks.catalogData as CockpitCatalogData}
              onAccentChange={vi.fn()}
              onThemeChange={vi.fn()}
              resolvedTheme="light"
              shellState={{ kind: "empty" }}
              theme="auto"
            >
              <DrawerProbe />
            </CockpitShell>
          </I18nProvider>
        </MemoryRouter>,
      );

      expect(screen.getByRole("main").getAttribute("data-session-drawer")).toBe(
        "true",
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open drawer" }));

      const drawer = screen.getByRole("dialog", { name: "Cockpit navigation" });
      expect(
        within(drawer).getByRole("region", { name: "Projects and sessions" }),
      ).toBeTruthy();
      expect(
        within(drawer).getByRole("button", { name: "Search" }),
      ).toBeTruthy();
      const settings = within(drawer).getByRole("link", { name: "Settings" });
      expect(settings.getAttribute("href")).toBe("/settings");
      // An installed phone app has no tabs: the settings stay in the window.
      expect(settings.getAttribute("target")).toBeNull();

      fireEvent.click(settings);
      expect(readCockpitReturn()?.path).toBe(
        "/cockpit/projects/p/sessions/s?keep=1",
      );
      // Navigating closes the drawer.
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      restore();
      sessionStorage.clear();
    }
  });

  it("keeps the labelled navigation outside an open session", () => {
    renderShell();
    expect(screen.getByRole("main").getAttribute("data-session-drawer")).toBe(
      null,
    );
  });

  it("renders only the catalog for the active responsive layout", () => {
    renderShell();

    expect(
      screen.getAllByRole("region", { name: "Projects and sessions" }),
    ).toHaveLength(1);
  });

  it("clears source-local catalog input when the source changes", () => {
    const view = render(
      <MemoryRouter initialEntries={["/cockpit"]}>
        <I18nProvider>
          <CockpitPage />
        </I18nProvider>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Sessions" }), {
      target: { value: "Atlas" },
    });

    pageMocks.runtime.sourceKey = "relay:studio";
    view.rerender(
      <MemoryRouter initialEntries={["/cockpit"]}>
        <I18nProvider>
          <CockpitPage />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(
      (
        screen.getByRole("searchbox", {
          name: "Sessions",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("stays stable when the transport returns a fresh snapshot object", () => {
    pageMocks.getSnapshot.mockClear();
    pageMocks.subscribe.mockClear();

    render(
      <MemoryRouter initialEntries={["/cockpit"]}>
        <I18nProvider>
          <CockpitPage />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Cockpit" })).toBeTruthy();
    expect(pageMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(pageMocks.getSnapshot.mock.calls.length).toBeLessThan(20);
  });

  it("renders independent relay navigation and the ready empty state", () => {
    renderShell();

    expect(screen.getByRole("heading", { name: "Cockpit" })).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("main").getAttribute("data-accent")).toBe("blue");
    expect(
      screen.getByRole("link", { name: "All Sessions" }).getAttribute("href"),
    ).toBe("/-/relay/studio/cockpit?view=sessions");
    expect(
      screen.getByRole("link", { name: "Projects" }).getAttribute("href"),
    ).toBe("/-/relay/studio/cockpit?view=projects");
    const settings = screen.getByRole("link", {
      name: "Settings (opens the existing view in a new tab)",
    });
    expect(settings.getAttribute("href")).toBe("/-/relay/studio/settings");
    expect(settings.getAttribute("target")).toBe("_blank");
    const quote = screen.getByRole("figure", { name: "Quote" });
    const first = quote.textContent;
    expect(first).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next quote" }));
    expect(screen.getByRole("figure", { name: "Quote" }).textContent).not.toBe(
      first,
    );
  });

  it("loads the German Cockpit copy instead of falling back to English", async () => {
    localStorage.setItem(UI_KEYS.locale, "de");
    renderShell();

    expect(await screen.findByText("Nächstes Zitat")).toBeTruthy();
    expect(screen.getByPlaceholderText("Suchen")).toBeTruthy();
    expect((await screen.findAllByText("Akzentfarbe")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Verbunden").length).toBeGreaterThan(0);
  });

  it("exposes browser-local theme and accent choices as pressed buttons", () => {
    const { onAccentChange, onThemeChange } = renderShell();

    expect(
      screen
        .getAllByRole("button", { name: "Auto" })[0]
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    const [darkButton] = screen.getAllByRole("button", { name: "Dark" });
    const [violetButton] = screen.getAllByRole("button", {
      name: "Use Violet accent",
    });
    if (!darkButton || !violetButton) throw new Error("choice buttons missing");
    fireEvent.click(darkButton);
    fireEvent.click(violetButton);

    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(onAccentChange).toHaveBeenCalledWith("violet");
  });

  it("keeps desktop appearance controls collapsed so the catalog can grow", () => {
    renderShell();

    const appearance = screen
      .getAllByLabelText("Appearance")
      .find((element) => element.tagName === "DETAILS");
    if (!(appearance instanceof HTMLDetailsElement)) {
      throw new Error("desktop appearance disclosure missing");
    }
    expect(appearance.open).toBe(false);
  });

  it("makes the Cockpit surface inert while shortcut help is modal", () => {
    renderShell();
    const root = screen.getByRole("main");
    const sidebar = root.querySelector("aside");
    const workspace = Array.from(root.children).find(
      (child) => child.tagName === "SECTION",
    );
    if (!sidebar || !workspace) throw new Error("Cockpit surface missing");
    const trigger = screen.getByRole("button", {
      name: "Keyboard shortcuts",
    });

    fireEvent.click(trigger);

    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(workspace.hasAttribute("inert")).toBe(true);
    const dialog = screen.getByRole("dialog");
    const close = screen
      .getAllByRole("button", { name: "Close shortcuts" })
      .find((button) => dialog.contains(button));
    if (!close) throw new Error("shortcut close button missing");
    fireEvent.click(close);
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(workspace.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("returns shortcut-help focus to its keyboard origin", () => {
    renderShell();
    const origin = screen.getAllByRole("link", { name: "New Session" }).at(-1);
    if (!origin) throw new Error("new-session focus origin missing");
    origin.focus();

    fireEvent.keyDown(origin, { key: "?" });
    const dialog = screen.getByRole("dialog");
    const close = screen
      .getAllByRole("button", { name: "Close shortcuts" })
      .find((button) => dialog.contains(button));
    if (!close) throw new Error("shortcut close button missing");
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it("returns search focus to its keyboard origin", () => {
    renderShell();
    const origin = screen.getAllByRole("link", { name: "New Session" }).at(-1);
    if (!origin) throw new Error("new-session focus origin missing");
    origin.focus();

    fireEvent.keyDown(origin, { key: "/" });
    const search = screen.getByRole("searchbox", {
      name: "Search all sessions",
    });
    expect(document.activeElement).toBe(search);

    fireEvent.keyDown(search, { key: "Escape" });

    expect(
      screen.queryByRole("searchbox", { name: "Search all sessions" }),
    ).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it("keeps focus on deliberate navigation away from search", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      screen.getByRole("searchbox", { name: "Search all sessions" }),
    ).toBeTruthy();
    const projects = screen.getByRole("link", { name: "Projects" });
    projects.focus();

    fireEvent.click(projects);

    expect(
      screen.queryByRole("searchbox", { name: "Search all sessions" }),
    ).toBeNull();
    expect(document.activeElement).toBe(projects);
  });

  it.each([
    ["loading", "Preparing your workspace", "status"],
    ["offline", "This source is offline", "status"],
    ["error", "The connection needs attention", "alert"],
  ] as const)(
    "renders the %s state with %s in an accessible %s",
    (kind, title, role) => {
      renderShell({ kind });
      expect(screen.getByRole(role).textContent?.includes(title)).toBe(true);
    },
  );
});
