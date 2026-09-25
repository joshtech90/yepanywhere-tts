import { act, renderHook } from "@testing-library/react";
import type { InputRequest } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useCockpitAttention,
  type CockpitAttentionActionResult,
} from "./useCockpitAttention";

const runtime = vi.hoisted(() => ({
  transport: { fetch: vi.fn() },
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));

const request: InputRequest = {
  id: "request-1",
  sessionId: "session-1",
  type: "tool-approval",
  prompt: "Allow the invented command?",
  toolName: "Bash",
  timestamp: "2026-09-24T10:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  runtime.transport.fetch.mockReset();
});

describe("Cockpit attention actions", () => {
  it("refreshes a request rejected as already answered", async () => {
    runtime.transport.fetch.mockImplementation((path: string) => {
      if (path === "/sessions/session-1/pending-input") {
        return Promise.resolve({ request: null });
      }
      return Promise.reject(
        Object.assign(new Error("stale"), { status: 400 }),
      );
    });
    const setPendingInputRequest = vi.fn();
    const { result } = renderHook(() =>
      useCockpitAttention({
        pendingInputRequest: request,
        processState: "waiting-input",
        setPendingInputRequest,
        setProcessState: vi.fn(),
        setStatus: vi.fn(),
        status: { owner: "self", processId: "process-1" },
      }),
    );

    let response: CockpitAttentionActionResult | null = null;
    await act(async () => {
      response = await result.current.respond("request-1", "approve");
    });

    expect(response).toEqual({ kind: "stale" });
    expect(runtime.transport.fetch).toHaveBeenCalledWith(
      "/sessions/session-1/pending-input",
    );
    expect(setPendingInputRequest).toHaveBeenCalledWith(null);
  });

  it("answers through the mounted source transport", async () => {
    runtime.transport.fetch.mockResolvedValue({ accepted: true });
    const { result } = renderHook(() =>
      useCockpitAttention({
        pendingInputRequest: request,
        processState: "waiting-input",
        setPendingInputRequest: vi.fn(),
        setProcessState: vi.fn(),
        setStatus: vi.fn(),
        status: { owner: "self", processId: "process-1" },
      }),
    );

    await act(async () => {
      expect(await result.current.respond("request-1", "approve")).toEqual({
        kind: "accepted",
      });
    });

    expect(runtime.transport.fetch.mock.calls[0]?.[0]).toBe(
      "/sessions/session-1/input",
    );
  });

  it("falls back from unsupported interrupt to verified process abort", async () => {
    runtime.transport.fetch.mockImplementation((path: string) => {
      if (path.endsWith("/interrupt")) {
        return Promise.resolve({ interrupted: false, supported: false });
      }
      return Promise.resolve({
        aborted: true,
        processId: "process-1",
        sessionId: "session-1",
        verifiedStopped: true,
        verification: "provider",
      });
    });
    const setProcessState = vi.fn();
    const setStatus = vi.fn();
    const { result } = renderHook(() =>
      useCockpitAttention({
        pendingInputRequest: null,
        processState: "in-turn",
        setPendingInputRequest: vi.fn(),
        setProcessState,
        setStatus,
        status: { owner: "self", processId: "process-1" },
      }),
    );

    await act(async () => {
      expect(await result.current.stop()).toEqual({ kind: "accepted" });
    });

    expect(runtime.transport.fetch.mock.calls.map((call) => call[0])).toEqual([
      "/processes/process-1/interrupt",
      "/processes/process-1/abort",
    ]);
    expect(setStatus).toHaveBeenCalledWith({ owner: "none" });
    expect(setProcessState).toHaveBeenCalledWith("idle");
  });
});
