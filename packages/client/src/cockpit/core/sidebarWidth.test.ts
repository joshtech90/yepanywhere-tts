import { describe, expect, it, vi } from "vitest";
import {
  clampCockpitSidebarWidth,
  clearCockpitSidebarWidth,
  COCKPIT_SIDEBAR_WIDTH_DEFAULT,
  COCKPIT_SIDEBAR_WIDTH_KEYBOARD_BIG_STEP,
  COCKPIT_SIDEBAR_WIDTH_KEYBOARD_STEP,
  COCKPIT_SIDEBAR_WIDTH_MAX,
  COCKPIT_SIDEBAR_WIDTH_MIN,
  COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
  nextCockpitSidebarWidthForKey,
  parseCockpitSidebarWidth,
  readCockpitSidebarWidth,
  saveCockpitSidebarWidth,
} from "./sidebarWidth";

describe("cockpit sidebar width core logic", () => {
  it("exposes expected default constants", () => {
    expect(COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY).toBe(
      "yep-anywhere-cockpit-sidebar-width",
    );
    expect(COCKPIT_SIDEBAR_WIDTH_DEFAULT).toBe(352);
    expect(COCKPIT_SIDEBAR_WIDTH_MIN).toBe(240);
    expect(COCKPIT_SIDEBAR_WIDTH_MAX).toBe(560);
    expect(COCKPIT_SIDEBAR_WIDTH_KEYBOARD_STEP).toBe(16);
    expect(COCKPIT_SIDEBAR_WIDTH_KEYBOARD_BIG_STEP).toBe(64);
  });

  describe("clampCockpitSidebarWidth", () => {
    it("rounds and keeps value within [MIN, MAX]", () => {
      expect(clampCockpitSidebarWidth(272)).toBe(272);
      expect(clampCockpitSidebarWidth(299.6)).toBe(300);
      expect(clampCockpitSidebarWidth(299.4)).toBe(299);
      expect(clampCockpitSidebarWidth(100)).toBe(COCKPIT_SIDEBAR_WIDTH_MIN);
      expect(clampCockpitSidebarWidth(700)).toBe(COCKPIT_SIDEBAR_WIDTH_MAX);
    });

    it("returns DEFAULT for NaN and non-finite values", () => {
      expect(clampCockpitSidebarWidth(Number.NaN)).toBe(
        COCKPIT_SIDEBAR_WIDTH_DEFAULT,
      );
      expect(clampCockpitSidebarWidth(Number.POSITIVE_INFINITY)).toBe(
        COCKPIT_SIDEBAR_WIDTH_DEFAULT,
      );
      expect(clampCockpitSidebarWidth(Number.NEGATIVE_INFINITY)).toBe(
        COCKPIT_SIDEBAR_WIDTH_DEFAULT,
      );
    });

    it("caps width according to viewportWidth constraints", () => {
      // 50% of 700 is 350 (< 560)
      expect(clampCockpitSidebarWidth(400, 700)).toBe(350);
      // Large viewport (1200) allows up to MAX (560)
      expect(clampCockpitSidebarWidth(450, 1200)).toBe(450);
      // Small viewport (300) caps at max(MIN, floor(150)) = MIN (240)
      expect(clampCockpitSidebarWidth(250, 300)).toBe(240);
    });
  });

  describe("parseCockpitSidebarWidth", () => {
    it("returns DEFAULT for missing or invalid payloads", () => {
      expect(parseCockpitSidebarWidth(null)).toBe(COCKPIT_SIDEBAR_WIDTH_DEFAULT);
      expect(parseCockpitSidebarWidth("")).toBe(COCKPIT_SIDEBAR_WIDTH_DEFAULT);
      expect(parseCockpitSidebarWidth("invalid json")).toBe(
        COCKPIT_SIDEBAR_WIDTH_DEFAULT,
      );
      expect(parseCockpitSidebarWidth(JSON.stringify({ version: 2, width: 300 }))).toBe(
        COCKPIT_SIDEBAR_WIDTH_DEFAULT,
      );
      expect(parseCockpitSidebarWidth(JSON.stringify({ version: 1, width: "300" }))).toBe(
        COCKPIT_SIDEBAR_WIDTH_DEFAULT,
      );
      expect(
        parseCockpitSidebarWidth(JSON.stringify({ version: 1, width: Number.NaN })),
      ).toBe(COCKPIT_SIDEBAR_WIDTH_DEFAULT);
    });

    it("parses and clamps valid records", () => {
      expect(
        parseCockpitSidebarWidth(JSON.stringify({ version: 1, width: 320 })),
      ).toBe(320);
      expect(
        parseCockpitSidebarWidth(JSON.stringify({ version: 1, width: 999 })),
      ).toBe(COCKPIT_SIDEBAR_WIDTH_MAX);
    });
  });

  describe("readCockpitSidebarWidth", () => {
    it("returns DEFAULT when storage is null or throws", () => {
      expect(readCockpitSidebarWidth(null)).toBe(COCKPIT_SIDEBAR_WIDTH_DEFAULT);
      const throwingStorage: Pick<Storage, "getItem"> = {
        getItem: () => {
          throw new Error("Access denied");
        },
      };
      expect(readCockpitSidebarWidth(throwingStorage)).toBe(
        COCKPIT_SIDEBAR_WIDTH_DEFAULT,
      );
    });

    it("reads valid width from storage", () => {
      const storage: Pick<Storage, "getItem"> = {
        getItem: vi.fn(() => JSON.stringify({ version: 1, width: 350 })),
      };
      expect(readCockpitSidebarWidth(storage)).toBe(350);
      expect(storage.getItem).toHaveBeenCalledWith(
        COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
      );
    });
  });

  describe("saveCockpitSidebarWidth and clearCockpitSidebarWidth", () => {
    it("saves versioned payload with clamped width", () => {
      const setItem = vi.fn();
      const storage: Pick<Storage, "setItem"> = { setItem };
      saveCockpitSidebarWidth(storage, 350);
      expect(setItem).toHaveBeenCalledWith(
        COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
        JSON.stringify({ version: 1, width: 350 }),
      );
    });

    it("swallows exceptions when storage writes fail", () => {
      const throwingStorage: Pick<Storage, "setItem"> = {
        setItem: () => {
          throw new Error("Quota exceeded");
        },
      };
      expect(() =>
        saveCockpitSidebarWidth(throwingStorage, 300),
      ).not.toThrow();
    });

    it("removes storage key and swallows exceptions", () => {
      const removeItem = vi.fn();
      const storage: Pick<Storage, "removeItem"> = { removeItem };
      clearCockpitSidebarWidth(storage);
      expect(removeItem).toHaveBeenCalledWith(
        COCKPIT_SIDEBAR_WIDTH_STORAGE_KEY,
      );

      const throwingStorage: Pick<Storage, "removeItem"> = {
        removeItem: () => {
          throw new Error("Unavailable");
        },
      };
      expect(() => clearCockpitSidebarWidth(throwingStorage)).not.toThrow();
    });
  });

  describe("nextCockpitSidebarWidthForKey", () => {
    it("steps sidebar width left and right", () => {
      expect(nextCockpitSidebarWidthForKey(272, "ArrowLeft", false)).toBe(256);
      expect(nextCockpitSidebarWidthForKey(272, "ArrowRight", false)).toBe(288);
      expect(nextCockpitSidebarWidthForKey(272, "ArrowLeft", true)).toBe(240);
      expect(nextCockpitSidebarWidthForKey(272, "ArrowRight", true)).toBe(336);
    });

    it("jumps to bounds on Home and End", () => {
      expect(nextCockpitSidebarWidthForKey(300, "Home", false)).toBe(
        COCKPIT_SIDEBAR_WIDTH_MIN,
      );
      expect(nextCockpitSidebarWidthForKey(300, "End", false)).toBe(
        COCKPIT_SIDEBAR_WIDTH_MAX,
      );
    });

    it("returns null for unrelated keys", () => {
      expect(nextCockpitSidebarWidthForKey(272, "ArrowUp", false)).toBeNull();
      expect(nextCockpitSidebarWidthForKey(272, "Enter", false)).toBeNull();
      expect(nextCockpitSidebarWidthForKey(272, "Tab", false)).toBeNull();
    });
  });
});
