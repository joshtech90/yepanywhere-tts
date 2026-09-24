import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { CockpitShell } from "./CockpitPage";
import type { CockpitShellState } from "./core/shellState";

afterEach(cleanup);

function renderShell(shellState: CockpitShellState = { kind: "empty" }) {
  const onAccentChange = vi.fn();
  const onThemeChange = vi.fn();
  render(
    <MemoryRouter initialEntries={["/-/relay/studio/cockpit"]}>
      <I18nProvider>
        <CockpitShell
          accent="blue"
          basePath="/-/relay/studio/"
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
      screen.getByRole("status").textContent?.includes("A calm place"),
    ).toBe(true);
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
