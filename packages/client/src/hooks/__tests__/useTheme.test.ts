import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import { getResolvedTheme, initializeTheme, useTheme } from "../useTheme";

/** What the browser delivers to this tab when another tab saves the theme. */
function themeSavedInAnotherTab(theme: string | null): void {
  if (theme === null) {
    localStorage.clear();
  } else {
    localStorage.setItem(UI_KEYS.theme, theme);
  }
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: theme === null ? null : UI_KEYS.theme,
      newValue: theme,
    }),
  );
}

describe("theme shared across tabs", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(UI_KEYS.theme, "dark");
    initializeTheme();
  });

  it("shows the page in the appearance another tab chose", () => {
    themeSavedInAnotherTab("light");

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(getResolvedTheme()).toBe("light");
  });

  it("returns to the default when another tab clears storage", () => {
    themeSavedInAnotherTab(null);

    expect(document.documentElement.getAttribute("data-theme")).toBe("auto");
  });

  it("ignores other keys", () => {
    localStorage.setItem(UI_KEYS.theme, "light");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "some-other-key" }),
    );

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("keeps an open theme picker on the choice another tab made", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => themeSavedInAnotherTab("verydark"));

    expect(result.current.theme).toBe("verydark");
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "verydark",
    );
  });
});
