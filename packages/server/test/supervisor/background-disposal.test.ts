import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockClaudeSDK, MockRealClaudeSDK } from "../../src/sdk/mock.js";
import {
  Supervisor,
  type HeartbeatTurnCandidate,
} from "../../src/supervisor/Supervisor.js";

let supervisor: Supervisor | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await supervisor?.stopBackgroundTasks();
  supervisor = undefined;
  vi.useRealTimers();
});

describe("Supervisor background ownership", () => {
  it("releases maintenance timers and ignores later schedule announcements", async () => {
    const candidates = vi.fn(async () => []);
    supervisor = new Supervisor({
      sdk: new MockClaudeSDK(),
      getHeartbeatTurnCandidates: candidates,
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(candidates).toHaveBeenCalledOnce();
    await supervisor.stopBackgroundTasks();
    expect(vi.getTimerCount()).toBe(0);
    supervisor.notifyHeartbeatScheduleChanged();
    await vi.advanceTimersByTimeAsync(120000);
    expect(candidates).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an admitted candidate read and cannot resume returned work after stop", async () => {
    let release!: (candidates: HeartbeatTurnCandidate[]) => void;
    const held = new Promise<HeartbeatTurnCandidate[]>((resolve) => {
      release = resolve;
    });
    supervisor = new Supervisor({
      realSdk: new MockRealClaudeSDK(),
      getHeartbeatTurnCandidates: () => held,
      getHeartbeatTurnSettings: () => ({
        enabled: true,
        afterMinutes: 1,
        text: "heartbeat",
      }),
    });
    const resume = vi
      .spyOn(supervisor, "resumeSession")
      .mockResolvedValue({ error: "unexpected late resume" });
    await vi.advanceTimersByTimeAsync(30000);
    let disposed = false;
    const disposal = supervisor.stopBackgroundTasks().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    release([
      {
        sessionId: "old-candidate",
        projectId: toUrlProjectId("L3RtcC9vd25lZA"),
        projectPath: "/tmp/owned",
        provider: "claude",
        updatedAt: "2020-01-01T00:00:00Z",
        hasPendingToolCall: true,
      },
    ]);
    await disposal;
    expect(resume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the live provider owned when maintenance work stops", async () => {
    supervisor = new Supervisor({ realSdk: new MockRealClaudeSDK() });
    const started = await supervisor.startSession("/tmp/owned", {
      text: "live turn",
    });
    if (!("id" in started)) throw new Error("Expected a live process");
    const abort = vi.spyOn(started, "abort");
    await supervisor.stopBackgroundTasks();
    expect(supervisor.getProcessForSession(started.sessionId)).toBe(started);
    expect(abort).not.toHaveBeenCalled();
    vi.useRealTimers();
    await supervisor.abortProcess(started.id);
  });

  it("does not leave maintenance timers behind when construction is rejected", () => {
    expect(() => new Supervisor({})).toThrow("must be provided");
    expect(vi.getTimerCount()).toBe(0);
  });
});
