import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YaSourceRuntime } from "../lib/sourceRuntime";
import { useCockpitOrganization } from "./useCockpitOrganization";

const runtimes = vi.hoisted(() => ({
  current: null as YaSourceRuntime | null,
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtimes.current,
}));

function runtime(sourceKey: string): YaSourceRuntime {
  return {
    sourceKey: sourceKey as YaSourceRuntime["sourceKey"],
    transport: {
      fetch: vi.fn().mockResolvedValue({ updated: true }),
    } as unknown as YaSourceRuntime["transport"],
    summary: {
      reportSessionCollectionMetadataChanged: vi.fn(),
    } as unknown as YaSourceRuntime["summary"],
    api: {} as YaSourceRuntime["api"],
    sessionDetails: {} as YaSourceRuntime["sessionDetails"],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  localStorage.clear();
  runtimes.current = runtime("host:alpha");
});

describe("useCockpitOrganization", () => {
  it("ignores a delayed pin failure after switching sources", async () => {
    const alpha = runtimes.current;
    if (!alpha) throw new Error("alpha runtime missing");
    const alphaRequest = deferred<{ updated: boolean }>();
    vi.mocked(alpha.transport.fetch).mockReturnValueOnce(alphaRequest.promise);
    const { result, rerender } = renderHook(() => useCockpitOrganization());

    let alphaToggle!: Promise<boolean>;
    act(() => {
      alphaToggle = result.current.togglePin("shared-session", true);
    });
    expect(result.current.pendingPins.has("shared-session")).toBe(true);

    const beta = runtime("host:beta");
    const betaRequest = deferred<{ updated: boolean }>();
    vi.mocked(beta.transport.fetch).mockReturnValueOnce(betaRequest.promise);
    runtimes.current = beta;
    rerender();
    let betaToggle!: Promise<boolean>;
    act(() => {
      betaToggle = result.current.togglePin("shared-session", false);
    });
    expect(result.current.pendingPins.has("shared-session")).toBe(true);

    await act(async () => {
      alphaRequest.reject(new Error("alpha offline"));
      await alphaToggle;
    });

    expect(result.current.pinError).toBe(false);
    expect(result.current.pendingPins.has("shared-session")).toBe(true);

    await act(async () => {
      betaRequest.resolve({ updated: true });
      await betaToggle;
    });
  });

  it("pins the same session id only on the active source", async () => {
    const alpha = runtimes.current;
    if (!alpha) throw new Error("alpha runtime missing");
    const { result, rerender } = renderHook(() => useCockpitOrganization());

    await act(async () => {
      await result.current.togglePin("shared-session", true);
    });

    const beta = runtime("host:beta");
    runtimes.current = beta;
    rerender();
    await act(async () => {
      await result.current.togglePin("shared-session", false);
    });

    expect(alpha.transport.fetch).toHaveBeenCalledWith(
      "/sessions/shared-session/metadata",
      expect.objectContaining({ body: JSON.stringify({ starred: true }) }),
    );
    expect(beta.transport.fetch).toHaveBeenCalledWith(
      "/sessions/shared-session/metadata",
      expect.objectContaining({ body: JSON.stringify({ starred: false }) }),
    );
    expect(
      alpha.summary.reportSessionCollectionMetadataChanged,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "shared-session",
        starred: true,
      }),
    );
  });

  it("keeps the visible pin unchanged when an older server rejects metadata", async () => {
    const current = runtimes.current;
    if (!current) throw new Error("runtime missing");
    vi.mocked(current.transport.fetch).mockRejectedValueOnce(
      new Error("not found"),
    );
    const { result } = renderHook(() => useCockpitOrganization());

    await act(async () => {
      expect(await result.current.togglePin("session-1", true)).toBe(false);
    });

    expect(result.current.pinError).toBe(true);
    expect(
      current.summary.reportSessionCollectionMetadataChanged,
    ).not.toHaveBeenCalled();
  });
});
