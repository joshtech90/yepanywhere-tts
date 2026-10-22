import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetCockpitPeer, useCockpitPeer } from "./CockpitHostSwitch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetCockpitPeer();
});

describe("Cockpit host discovery", () => {
  it("recovers the host switch when an offline page reconnects", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            label: "aihub",
            url: "https://aihub.example.ts.net/cockpit",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useCockpitPeer());
    await act(async () => {});
    expect(result.current).toBeNull();
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(result.current?.label).toBe("aihub"));
  });

  it("keeps a plain install without a peer file at a single request", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response("<!doctype html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useCockpitPeer());
    await act(async () => {});
    act(() => window.dispatchEvent(new Event("online")));
    await act(async () => {});
    expect(result.current).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
