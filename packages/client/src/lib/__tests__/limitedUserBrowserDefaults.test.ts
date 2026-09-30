import { BROWSER_SETTINGS_BACKUP_VERSION } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import { applyLimitedUserBrowserDefaults } from "../limitedUserBrowserDefaults";
import { UI_KEYS } from "../storageKeys";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const revision = (savedAt: string, values: Record<string, string>) => ({
  version: BROWSER_SETTINGS_BACKUP_VERSION,
  savedAt,
  values,
});

describe("applyLimitedUserBrowserDefaults", () => {
  it("applies each revision once and then leaves local changes alone", () => {
    const storage = memoryStorage({ [UI_KEYS.fontSize]: "small" });
    const first = revision("2026-09-28T00:00:00.000Z", {
      [UI_KEYS.theme]: "dark",
    });

    expect(applyLimitedUserBrowserDefaults(first, "alice", storage)).toBe(true);
    expect(storage.getItem(UI_KEYS.theme)).toBe("dark");
    expect(storage.getItem(UI_KEYS.fontSize)).toBe("small");

    storage.setItem(UI_KEYS.theme, "light");
    expect(applyLimitedUserBrowserDefaults(first, "alice", storage)).toBe(
      false,
    );
    expect(storage.getItem(UI_KEYS.theme)).toBe("light");

    const second = revision("2026-09-29T00:00:00.000Z", {
      [UI_KEYS.theme]: "dark",
    });
    expect(applyLimitedUserBrowserDefaults(second, "alice", storage)).toBe(
      true,
    );
    expect(storage.getItem(UI_KEYS.theme)).toBe("dark");
  });

  it("tracks revisions per account and reports no change when values match", () => {
    const storage = memoryStorage({ [UI_KEYS.theme]: "dark" });
    const defaults = revision("2026-09-28T00:00:00.000Z", {
      [UI_KEYS.theme]: "dark",
    });
    expect(applyLimitedUserBrowserDefaults(defaults, "alice", storage)).toBe(
      false,
    );
    storage.setItem(UI_KEYS.theme, "light");
    expect(applyLimitedUserBrowserDefaults(defaults, "bob", storage)).toBe(
      true,
    );
  });

  it("ignores keys outside the portable settings list", () => {
    const storage = memoryStorage();
    applyLimitedUserBrowserDefaults(
      revision("2026-09-28T00:00:00.000Z", { "some-credential": "x" }),
      "alice",
      storage,
    );
    expect(storage.getItem("some-credential")).toBeNull();
  });

  it("restores prior values and stays unapplied when storage fails", () => {
    const storage = memoryStorage({ [UI_KEYS.theme]: "light" });
    const failing = {
      ...storage,
      setItem: (key: string, value: string) => {
        if (key === UI_KEYS.fontSize) throw new Error("quota");
        storage.setItem(key, value);
      },
    };
    const defaults = revision("2026-09-28T00:00:00.000Z", {
      [UI_KEYS.theme]: "dark",
      [UI_KEYS.fontSize]: "large",
    });
    expect(() =>
      applyLimitedUserBrowserDefaults(defaults, "alice", failing),
    ).toThrow("quota");
    expect(storage.getItem(UI_KEYS.theme)).toBe("light");
    expect(applyLimitedUserBrowserDefaults(defaults, "alice", storage)).toBe(
      true,
    );
  });
});
