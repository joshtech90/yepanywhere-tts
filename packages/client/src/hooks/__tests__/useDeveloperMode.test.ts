// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  __resetDeveloperModeForTest,
  getRemoteLogCollectionEnabled,
  useDeveloperMode,
} from "../useDeveloperMode";

describe("useDeveloperMode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetDeveloperModeForTest();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    __resetDeveloperModeForTest();
  });

  it("defaults experimental developer features to disabled", () => {
    const { result } = renderHook(() => useDeveloperMode());

    expect(result.current.retainRejectedSrpSessions).toBe(false);
    expect(result.current.remoteLogCollectionEnabled).toBe(false);
    expect(getRemoteLogCollectionEnabled()).toBe(false);
  });

  it("persists and publishes the relay debug setting", () => {
    const { result: first } = renderHook(() => useDeveloperMode());
    const { result: second } = renderHook(() => useDeveloperMode());

    act(() => {
      first.current.setRelayDebugEnabled(true);
    });

    expect(first.current.relayDebugEnabled).toBe(true);
    expect(second.current.relayDebugEnabled).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(UI_KEYS.developerMode) ?? "{}"),
    ).toMatchObject({
      relayDebugEnabled: true,
    });
  });

  it("keeps credential retention independent of Browser Diagnostics and deletes on disable", () => {
    const { result } = renderHook(() => useDeveloperMode());
    act(() => result.current.setRetainRejectedSrpSessions(true));
    expect(result.current.retainRejectedSrpSessions).toBe(true);
    expect(result.current.remoteLogCollectionEnabled).toBe(false);
    localStorage.setItem(
      "yep-anywhere-rejected-srp-resume-v1",
      "sentinel-secret",
    );
    act(() => result.current.setRetainRejectedSrpSessions(false));
    expect(
      localStorage.getItem("yep-anywhere-rejected-srp-resume-v1"),
    ).toBeNull();
  });

  it("honors another tab opting out before unrelated preference changes", () => {
    const { result } = renderHook(() => useDeveloperMode());
    act(() => result.current.setRetainRejectedSrpSessions(true));
    act(() => {
      localStorage.setItem(
        UI_KEYS.developerMode,
        JSON.stringify({ retainRejectedSrpSessions: false }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: UI_KEYS.developerMode }),
      );
    });
    expect(result.current.retainRejectedSrpSessions).toBe(false);
    act(() => result.current.setRelayDebugEnabled(true));
    expect(
      JSON.parse(localStorage.getItem(UI_KEYS.developerMode) ?? "{}")
        .retainRejectedSrpSessions,
    ).toBe(false);
  });

  it("persists and publishes remote log collection updates", () => {
    const { result: first } = renderHook(() => useDeveloperMode());
    const { result: second } = renderHook(() => useDeveloperMode());

    act(() => {
      first.current.setRemoteLogCollectionEnabled(true);
    });

    expect(first.current.remoteLogCollectionEnabled).toBe(true);
    expect(second.current.remoteLogCollectionEnabled).toBe(true);
    expect(getRemoteLogCollectionEnabled()).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(UI_KEYS.developerMode) ?? "{}"),
    ).toMatchObject({
      remoteLogCollectionEnabled: true,
    });
  });
});
