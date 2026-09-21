import type { SessionClearloopJob, UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionMetadataService } from "../../src/metadata/index.js";
import { ClearloopService } from "../../src/services/ClearloopService.js";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";
import { EventBus } from "../../src/watcher/EventBus.js";

const sessionId = "loop-session";
const projectId = Buffer.from("/home/user/test-project").toString(
  "base64url",
) as UrlProjectId;

/** Enough of the metadata service for the clearloop record and its notice. */
function fakeMetadataService(): SessionMetadataService & {
  notices: string[];
} {
  let clearloop: SessionClearloopJob | undefined;
  const notices: string[] = [];
  return {
    notices,
    getClearloop: () => clearloop,
    setClearloop: async (_id: string, job: SessionClearloopJob | undefined) => {
      clearloop = job;
    },
    addLocalCommandMessage: async (
      _id: string,
      notice: { content: string },
    ) => {
      notices.push(notice.content);
    },
  } as unknown as SessionMetadataService & { notices: string[] };
}

/**
 * A loop stopped at a chosen point of its own iteration: `rewind` and `send`
 * only resolve when the test says so, so the service sits in the state under
 * test rather than racing its inactivity timer.
 */
function startLoop(options?: { holdRewind?: boolean }) {
  const eventBus = new EventBus();
  const sessionMetadataService = fakeMetadataService();
  const service = new ClearloopService({
    eventBus,
    sessionMetadataService,
    getSupervisor: () =>
      ({ getProcessForSession: () => undefined }) as unknown as Supervisor,
    getInactivitySeconds: () => 30,
  });
  let releaseRewind = (): void => {};
  let releaseSend = (): void => {};
  service.setRunner({
    rewind: async () => {
      if (options?.holdRewind) {
        await new Promise<void>((resolve) => {
          releaseRewind = resolve;
        });
      }
      return "noop";
    },
    send: async () => {
      await new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
    },
  });
  const started = service.start(sessionId, projectId, {
    cutMessageId: "cut-1",
    cutTurnIndex: 3,
    prompt: "keep going",
    total: 2,
    commandText: "/clearloop 30 2: keep going",
  });
  return {
    service,
    eventBus,
    sessionMetadataService,
    started,
    release: () => {
      releaseRewind();
      releaseSend();
    },
  };
}

function stopRequested() {
  return {
    type: "session-stop-requested" as const,
    sessionId,
    projectId,
    timestamp: new Date().toISOString(),
  };
}

function aborted() {
  return {
    type: "session-aborted" as const,
    sessionId,
    projectId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * A loop whose iterations complete immediately and whose inactivity window is
 * zero, so every boundary is reached at once and only the patience gate
 * decides whether the loop advances.
 */
function startPatientLoop(options?: {
  blockers?: () => string[];
  patient?: boolean;
  total?: number;
}) {
  const sessionMetadataService = fakeMetadataService();
  const idleReads: number[] = [];
  const service = new ClearloopService({
    eventBus: new EventBus(),
    sessionMetadataService,
    getSupervisor: () =>
      ({ getProcessForSession: () => undefined }) as unknown as Supervisor,
    getInactivitySeconds: () => 0,
    patientRecheckMs: 20,
    ...(options?.blockers
      ? {
          getProjectIdleStatus: async () => {
            idleReads.push(Date.now());
            const blockers = options.blockers?.() ?? [];
            return { idle: blockers.length === 0, blockers };
          },
        }
      : {}),
  });
  const sent: string[] = [];
  service.setRunner({
    rewind: async () => "noop",
    send: async ({ job }) => {
      sent.push(job.prompt);
    },
  });
  const started = service.start(sessionId, projectId, {
    cutMessageId: "cut-1",
    cutTurnIndex: 3,
    prompt: "keep going",
    total: options?.total ?? 2,
    commandText: "/clearloop 3 2: keep going",
    ...(options?.patient ? { patient: true } : {}),
  });
  return { service, sessionMetadataService, started, sent, idleReads };
}

describe("ClearloopService patience", () => {
  it("refuses to become patient with no project idle predicate", async () => {
    const { service, started } = startPatientLoop({ total: 1 });
    await started;

    await expect(service.setPatience(sessionId, true)).rejects.toThrow(
      /cannot report project idleness/,
    );
    expect(service.getRunningJob(sessionId)?.patient).toBeUndefined();
  });

  it("holds a patient loop while the project reports blockers", async () => {
    let blockers = ["other-session:in-turn"];
    const { service, sent, started } = startPatientLoop({
      patient: true,
      blockers: () => blockers,
    });
    await started;

    // The first iteration is sent before any boundary; the second one is what
    // the project wait gates.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(() =>
      expect(service.getProgress(sessionId)?.projectBlockers).toEqual([
        "other-session:in-turn",
      ]),
    );
    expect(sent).toHaveLength(1);

    blockers = [];
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(service.getProgress(sessionId)?.projectBlockers).toBeUndefined();
  });

  it("ignores blockers naming the loop's own session", async () => {
    const { sent, started } = startPatientLoop({
      patient: true,
      blockers: () => [`${sessionId}:liveness-unknown`],
    });
    await started;

    await vi.waitFor(() => expect(sent).toHaveLength(2));
  });

  it("starts the next iteration now, skipping the project wait", async () => {
    const { service, sent, started } = startPatientLoop({
      patient: true,
      blockers: () => ["other-session:in-turn"],
    });
    await started;
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    await service.startNow(sessionId);
    expect(sent).toHaveLength(2);
  });

  it("turns patience off and lets the loop advance again", async () => {
    const { service, sent, started } = startPatientLoop({
      patient: true,
      blockers: () => ["other-session:in-turn"],
    });
    await started;
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    await service.setPatience(sessionId, false);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(service.getProgress(sessionId)?.patient).toBeUndefined();
  });
});

describe("ClearloopService stop handling", () => {
  it("ends the loop when a turn stop is requested", async () => {
    const { service, eventBus, sessionMetadataService, started, release } =
      startLoop();
    await started;
    await vi.waitFor(() => expect(service.isRunning(sessionId)).toBe(true));

    eventBus.emit(stopRequested());
    await vi.waitFor(() =>
      expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
        "interrupted",
      ),
    );
    expect(sessionMetadataService.getClearloop(sessionId)?.error).toBe(
      "Session was stopped",
    );
    await vi.waitFor(() =>
      expect(sessionMetadataService.notices.at(-1)).toContain("interrupted"),
    );

    release();
  });

  it("keeps running when an idle reap tears down the quiet process", async () => {
    const { service, eventBus, sessionMetadataService, started, release } =
      startLoop();
    await started;
    await vi.waitFor(() => expect(service.isRunning(sessionId)).toBe(true));

    eventBus.emit({ ...aborted(), reason: "idle-reap" });
    await Promise.resolve();
    expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
      "running",
    );

    release();
  });

  it("ends the loop when the provider refuses the iteration's rewind", async () => {
    const { service, eventBus, sessionMetadataService, started, release } =
      startLoop();
    await started;
    await vi.waitFor(() => expect(service.isRunning(sessionId)).toBe(true));

    eventBus.emit({
      type: "session-metadata-changed",
      sessionId,
      projectId,
      rewindRecordRemoved: "rw-1",
      timestamp: new Date().toISOString(),
    });
    await vi.waitFor(() =>
      expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
        "interrupted",
      ),
    );
    expect(sessionMetadataService.getClearloop(sessionId)?.error).toContain(
      "refused the rewind",
    );

    release();
  });

  it("keeps running through the abort its own rewind causes", async () => {
    const { service, eventBus, sessionMetadataService, started, release } =
      startLoop({ holdRewind: true });
    await started;

    eventBus.emit(aborted());
    await Promise.resolve();
    expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
      "running",
    );

    // A stop request during the same window is never the loop's own: the
    // rewind aborts rather than interrupting.
    eventBus.emit(stopRequested());
    await vi.waitFor(() => expect(service.isRunning(sessionId)).toBe(false));
    expect(sessionMetadataService.getClearloop(sessionId)?.state).toBe(
      "interrupted",
    );

    release();
  });
});
