// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import { useSidebarPreference } from "../useSidebarPreference";

describe("useSidebarPreference", () => {
  beforeEach(() => {
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
    vi.unstubAllGlobals();
  });

  it("forces the initial state open without overwriting the saved preference", () => {
    localStorage.setItem(UI_KEYS.sidebarExpanded, "false");

    const { result } = renderHook(() => useSidebarPreference(true));

    expect(result.current.isExpanded).toBe(true);
    expect(localStorage.getItem(UI_KEYS.sidebarExpanded)).toBe("false");
  });

  it("minimizes to a persisted floating toggle and restores the collapsed rail", () => {
    const { result } = renderHook(() => useSidebarPreference());

    act(() => result.current.minimizeToFloatingToggle());

    expect(result.current.isExpanded).toBe(false);
    expect(result.current.isMinimized).toBe(true);
    expect(localStorage.getItem(UI_KEYS.sidebarExpanded)).toBe("false");
    expect(localStorage.getItem(UI_KEYS.sidebarMinimized)).toBe("true");

    act(() => result.current.restoreCollapsedSidebar());

    expect(result.current.isExpanded).toBe(false);
    expect(result.current.isMinimized).toBe(false);
    expect(localStorage.getItem(UI_KEYS.sidebarMinimized)).toBe("false");
  });

  it("starts collapsed without changing other windows' saved preference", () => {
    localStorage.setItem(UI_KEYS.sidebarExpanded, "true");
    const { result, rerender } = renderHook(
      ({ collapsed }) => useSidebarPreference(false, collapsed),
      { initialProps: { collapsed: true } },
    );
    expect(result.current.isExpanded).toBe(false);
    expect(localStorage.getItem(UI_KEYS.sidebarExpanded)).toBe("true");
    act(() => result.current.toggleExpanded());
    rerender({ collapsed: true });
    expect(result.current.isExpanded).toBe(true);
  });

  it("preserves minimized mode and honors the explicit expanded override", () => {
    localStorage.setItem(UI_KEYS.sidebarExpanded, "false");
    localStorage.setItem(UI_KEYS.sidebarMinimized, "true");
    const minimized = renderHook(() => useSidebarPreference(false, true));
    expect(minimized.result.current.isMinimized).toBe(true);
    const expanded = renderHook(() => useSidebarPreference(true, true));
    expect(expanded.result.current.isExpanded).toBe(true);
  });
});
