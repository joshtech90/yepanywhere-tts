import { act, renderHook } from "@testing-library/react";
import type { InputRequest } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import {
  useCockpitAttention,
  type CockpitAttentionActionResult,
} from "./useCockpitAttention";

const request: InputRequest = {
  id: "request-1",
  sessionId: "session-1",
  type: "tool-approval",
  prompt: "Allow the invented command?",
  toolName: "Bash",
  timestamp: "2026-09-24T10:00:00.000Z",
};

afterEach(() => vi.restoreAllMocks());

describe("Cockpit attention actions", () => {
  it("refreshes a request rejected as already answered", async () => {
    vi.spyOn(api, "respondToInput").mockRejectedValue(
      Object.assign(new Error("stale"), { status: 400 }),
    );
    vi.spyOn(api, "getPendingInputRequest").mockResolvedValue({
      request: null,
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
    expect(api.getPendingInputRequest).toHaveBeenCalledWith("session-1");
    expect(setPendingInputRequest).toHaveBeenCalledWith(null);
  });

  it("falls back from unsupported interrupt to verified process abort", async () => {
    vi.spyOn(api, "interruptProcess").mockResolvedValue({
      interrupted: false,
      supported: false,
    });
    vi.spyOn(api, "abortProcess").mockResolvedValue({
      aborted: true,
      processId: "process-1",
      sessionId: "session-1",
      verifiedStopped: true,
      verification: "provider",
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

    expect(api.interruptProcess).toHaveBeenCalledWith("process-1");
    expect(api.abortProcess).toHaveBeenCalledWith("process-1");
    expect(setStatus).toHaveBeenCalledWith({ owner: "none" });
    expect(setProcessState).toHaveBeenCalledWith("idle");
  });
});
