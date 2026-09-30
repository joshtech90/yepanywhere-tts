import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitNewSession } from "./CockpitNewSession";

const state = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; name: string; path: string }>,
  updateSetting: vi.fn(async () => {}),
}));

vi.mock("../hooks/useProjects", () => ({
  useProjects: () => ({ projects: state.projects }),
}));

vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({ providers: [], loading: false }),
}));

vi.mock("../hooks/useModelSettings", () => ({
  useModelSettings: () => ({ thinkingMode: "off", effortLevel: "medium" }),
}));

vi.mock("../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: {
      cockpitProjectFavorites: [
        { path: "/work/os", label: "SZ OS" },
        { path: "/work/fresh", label: "Fresh" },
      ],
    },
    updateSetting: state.updateSetting,
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  state.projects = [];
  state.updateSetting.mockClear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CockpitNewSession basePath="" />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Cockpit new session favourites", () => {
  it("picks a favourite's project and saves the star", () => {
    state.projects = [
      { id: "os", name: "Smartzone OS", path: "/work/os" },
      { id: "recent", name: "Recent", path: "/work/recent" },
    ];
    renderPage();
    const select = screen.getByRole("combobox", {
      name: "Project path",
    }) as HTMLSelectElement;

    fireEvent.click(screen.getByRole("button", { name: "SZ OS" }));
    expect(select.value).toBe("os");
    expect(
      screen
        .getByRole("button", { name: "SZ OS" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.change(select, { target: { value: "recent" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save folder as favorite" }),
    );
    expect(state.updateSetting).toHaveBeenCalledWith(
      "cockpitProjectFavorites",
      [
        { path: "/work/os", label: "SZ OS" },
        { path: "/work/fresh", label: "Fresh" },
        { path: "/work/recent", label: "Recent" },
      ],
    );
  });

  it("types an unknown folder in and moves to its project once known", () => {
    const { rerender } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Fresh" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Project path",
        }) as HTMLInputElement
      ).value,
    ).toBe("/work/fresh");

    state.projects = [{ id: "fresh", name: "Fresh", path: "/work/fresh" }];
    rerender(
      <MemoryRouter>
        <I18nProvider>
          <CockpitNewSession basePath="" />
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(
      (
        screen.getByRole("combobox", {
          name: "Project path",
        }) as HTMLSelectElement
      ).value,
    ).toBe("fresh");
    expect(screen.queryByRole("textbox", { name: "Project path" })).toBeNull();
  });
});
