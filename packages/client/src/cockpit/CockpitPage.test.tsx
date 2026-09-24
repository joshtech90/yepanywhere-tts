import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitPage, CockpitShell } from "./CockpitPage";
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

afterEach(cleanup);
beforeEach(() => localStorage.setItem(UI_KEYS.locale, "en"));

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
    ).toBe("/-/relay/studio/sessions");
    expect(
      screen.getByRole("link", { name: "Projects" }).getAttribute("href"),
    ).toBe("/-/relay/studio/projects");
    expect(
      screen.getByRole("status").textContent?.includes("calmly organized"),
    ).toBe(true);
  });

  it("loads the German Cockpit copy instead of falling back to English", async () => {
    localStorage.setItem(UI_KEYS.locale, "de");
    renderShell();

    expect(await screen.findByText("Dein KI-Arbeitsbereich")).toBeTruthy();
    expect((await screen.findAllByText("Akzentfarbe")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Verbunden").length).toBeGreaterThan(0);
  });

  it("exposes browser-local theme and accent choices as pressed buttons", () => {
    const { onAccentChange, onThemeChange } = renderShell();

    expect(
      screen.getAllByRole("button", { name: "Auto" })[0]?.getAttribute(
        "aria-pressed",
      ),
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
