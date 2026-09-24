import { describe, expect, it, vi } from "vitest";
import {
  COCKPIT_APPEARANCE_STORAGE_KEY,
  DEFAULT_COCKPIT_APPEARANCE,
  parseCockpitAppearance,
  readCockpitAppearance,
  resolveCockpitTheme,
  saveCockpitAppearance,
} from "./appearance";

describe("Cockpit appearance", () => {
  it("loads a versioned browser-local theme and accent", () => {
    expect(
      parseCockpitAppearance(
        JSON.stringify({ version: 1, theme: "dark", accent: "violet" }),
      ),
    ).toEqual({ theme: "dark", accent: "violet" });
  });

  it.each([
    null,
    "not-json",
    JSON.stringify({ version: 2, theme: "dark", accent: "violet" }),
    JSON.stringify({ version: 1, theme: "midnight", accent: "violet" }),
    JSON.stringify({ version: 1, theme: "dark", accent: "yellow" }),
  ])("falls back safely for unsupported storage value %s", (raw) => {
    expect(parseCockpitAppearance(raw)).toEqual(DEFAULT_COCKPIT_APPEARANCE);
  });

  it("writes one versioned preference record", () => {
    const setItem = vi.fn();
    saveCockpitAppearance({ setItem }, { theme: "light", accent: "teal" });

    expect(setItem).toHaveBeenCalledWith(
      COCKPIT_APPEARANCE_STORAGE_KEY,
      JSON.stringify({ version: 1, theme: "light", accent: "teal" }),
    );
  });

  it("keeps defaults when browser storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("unavailable");
      },
    };
    expect(readCockpitAppearance(storage)).toEqual(DEFAULT_COCKPIT_APPEARANCE);
    expect(() =>
      saveCockpitAppearance(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        { theme: "dark", accent: "coral" },
      ),
    ).not.toThrow();
  });

  it("resolves auto from the system while explicit choices stay stable", () => {
    expect(resolveCockpitTheme("auto", true)).toBe("dark");
    expect(resolveCockpitTheme("auto", false)).toBe("light");
    expect(resolveCockpitTheme("light", true)).toBe("light");
    expect(resolveCockpitTheme("dark", false)).toBe("dark");
  });
});
