import { describe, expect, it, vi } from "vitest";
import { requestCockpitStop, type CockpitStopClient } from "./stop";

function client(
  interruptResult: Awaited<
    ReturnType<CockpitStopClient["interruptProcess"]>
  >,
) {
  return {
    abortProcess: vi.fn(async () => ({ aborted: true })),
    interruptProcess: vi.fn(async () => interruptResult),
  } satisfies CockpitStopClient;
}

describe("Cockpit stop", () => {
  it("keeps a confirmed graceful interrupt server-authoritative", async () => {
    const api = client({ interrupted: true, supported: true });

    await expect(requestCockpitStop(api, "process-1")).resolves.toBe(
      "interrupted",
    );
    expect(api.interruptProcess).toHaveBeenCalledWith("process-1");
    expect(api.abortProcess).not.toHaveBeenCalled();
  });

  it("falls back to abort when interrupt is unsupported", async () => {
    const api = client({ interrupted: false, supported: false });

    await expect(requestCockpitStop(api, "process-2")).resolves.toBe(
      "aborted",
    );
    expect(api.abortProcess).toHaveBeenCalledWith("process-2");
  });

  it("surfaces a failed abort after the interrupt route fails", async () => {
    const api = client({ interrupted: false, supported: false });
    api.interruptProcess.mockRejectedValue(new Error("interrupt unavailable"));
    api.abortProcess.mockRejectedValue(new Error("stop unavailable"));

    await expect(requestCockpitStop(api, "process-3")).rejects.toThrow(
      "stop unavailable",
    );
  });
});
