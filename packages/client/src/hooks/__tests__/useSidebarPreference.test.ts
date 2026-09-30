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
      ({ initialMode }) => useSidebarPreference(false, initialMode),
      { initialProps: { initialMode: "collapsed" as const } },
    );
    expect(result.current.isExpanded).toBe(false);
    expect(localStorage.getItem(UI_KEYS.sidebarExpanded)).toBe("true");
    act(() => result.current.toggleExpanded());
    rerender({ initialMode: "collapsed" });
    expect(result.current.isExpanded).toBe(true);
  });

  it("preserves minimized mode and honors the explicit expanded override", () => {
    localStorage.setItem(UI_KEYS.sidebarExpanded, "false");
    localStorage.setItem(UI_KEYS.sidebarMinimized, "true");
    const minimized = renderHook(() =>
      useSidebarPreference(false, "collapsed"),
    );
    expect(minimized.result.current.isMinimized).toBe(true);
    const expanded = renderHook(() => useSidebarPreference(true, "collapsed"));
    expect(expanded.result.current.isExpanded).toBe(true);
  });

  it.each([
    ["expanded", "true", "false"],
    ["collapsed", "false", "false"],
    ["minimized", "false", "true"],
  ])("keeps the saved %s mode on remount", (mode, expanded, minimized) => {
    localStorage.setItem(UI_KEYS.sidebarExpanded, expanded);
    localStorage.setItem(UI_KEYS.sidebarMinimized, minimized);
    const first = renderHook(() => useSidebarPreference());
    first.unmount();
    const { result } = renderHook(() => useSidebarPreference());
    expect(result.current.isExpanded).toBe(mode === "expanded");
    expect(result.current.isMinimized).toBe(mode === "minimized");
    expect(localStorage.getItem(UI_KEYS.sidebarExpanded)).toBe(expanded);
    expect(localStorage.getItem(UI_KEYS.sidebarMinimized)).toBe(minimized);
  });
});
