// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateLocalStorageValues } from "../../lib/localStorageValue";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  getProjectCodeNamePreferences,
  useProjectCodeNamePreferences,
} from "../useProjectCodeNamePreferences";

const principalState = vi.hoisted(() => ({ username: null as string | null }));

vi.mock("../useActingPrincipal", () => ({
  useActingPrincipal: () => ({
    principal: { username: principalState.username },
  }),
  isLimitedPrincipal: (principal: { username: string | null }) =>
    principal.username !== null,
}));

describe("useProjectCodeNamePreferences", () => {
  beforeEach(() => {
    principalState.username = null;
    invalidateLocalStorageValues();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("defaults code names and their activity pulse off", () => {
    const { result } = renderHook(() => useProjectCodeNamePreferences());

    expect(result.current.projectCodeNamesEnabled).toBe(false);
    expect(result.current.projectCodeNameActivityPulseEnabled).toBe(false);
  });

  it("reads stored preferences", () => {
    localStorage.setItem(UI_KEYS.projectCodeNamesEnabled, "true");
    localStorage.setItem(UI_KEYS.projectCodeNameActivityPulseEnabled, "true");

    const { result } = renderHook(() => useProjectCodeNamePreferences());

    expect(result.current.projectCodeNamesEnabled).toBe(true);
    expect(result.current.projectCodeNameActivityPulseEnabled).toBe(true);
    expect(getProjectCodeNamePreferences()).toEqual({
      enabled: true,
      activityPulseEnabled: true,
    });
  });

  it("persists and publishes updates to mounted consumers", () => {
    const { result: first } = renderHook(() => useProjectCodeNamePreferences());
    const { result: second } = renderHook(() =>
      useProjectCodeNamePreferences(),
    );

    act(() => {
      first.current.setProjectCodeNamesEnabled(true);
      first.current.setProjectCodeNameActivityPulseEnabled(true);
    });

    expect(second.current.projectCodeNamesEnabled).toBe(true);
    expect(second.current.projectCodeNameActivityPulseEnabled).toBe(true);
    expect(localStorage.getItem(UI_KEYS.projectCodeNamesEnabled)).toBe("true");
    expect(
      localStorage.getItem(UI_KEYS.projectCodeNameActivityPulseEnabled),
    ).toBe("true");
  });

  it("defaults code names on for a limited user until they choose", () => {
    principalState.username = "archer";
    const { result } = renderHook(() => useProjectCodeNamePreferences());
    expect(result.current.projectCodeNamesEnabled).toBe(true);
    expect(result.current.projectCodeNameActivityPulseEnabled).toBe(false);

    act(() => result.current.setProjectCodeNamesEnabled(false));
    expect(result.current.projectCodeNamesEnabled).toBe(false);
    expect(localStorage.getItem(UI_KEYS.projectCodeNamesEnabled)).toBe("false");
  });
});
