import { describe, expect, it } from "vitest";
import { sessionQueueSummaries } from "../../src/routes/session-queue-summaries.js";

describe("sessionQueueSummaries", () => {
  it("projects a durable pending boundary without a live process", () => {
    const deferred = sessionQueueSummaries(
      {
        sessionMetadataService: {
          getMetadata: () => ({
            pendingSyntheticDone: {
              message: {
                type: "user",
                content: "/archive",
                message: { role: "user", content: "/archive" },
                timestamp: "2026-08-16T10:00:00.000Z",
                uuid: "durable-boundary-1",
                id: "durable-boundary-1",
                isSynthetic: true,
                yaSyntheticSource: "done",
              },
              userTurnVersion: 4,
            },
          }),
        },
      },
      "session-1",
      undefined,
    );

    expect(deferred).toEqual([
      {
        tempId: "durable-boundary-1",
        content: "/archive",
        timestamp: "2026-08-16T10:00:00.000Z",
        kind: "ya-command",
        yaCommand: "done",
        status: "queued",
      },
    ]);
  });
});

describe("sessionQueueSummaries clearloop entry", () => {
  it("appends the running clearloop job last as a ya-command entry", () => {
    const deferred = sessionQueueSummaries(
      {
        sessionMetadataService: { getMetadata: () => undefined },
        clearloopService: {
          getRunningJob: () => ({
            id: "loop-1",
            cutMessageId: "a1",
            cutTurnIndex: 1,
            prompt: "try again",
            total: 3,
            completed: 1,
            state: "running" as const,
            startedAt: "2026-09-18T09:00:00.000Z",
            commandText: "/clearloop 1 3: try again",
          }),
          getProgress: () => ({
            completed: 1,
            total: 3,
            state: "running" as const,
            quietSince: "2026-09-18T09:00:30.000Z",
            windowSeconds: 60,
          }),
        },
      },
      "session-1",
      undefined,
    );
    expect(deferred).toEqual([
      {
        tempId: "ya-clearloop-loop-1",
        content: "try again",
        timestamp: "2026-09-18T09:00:00.000Z",
        kind: "ya-command",
        yaCommand: "clearloop",
        clearloop: {
          completed: 1,
          total: 3,
          state: "running",
          quietSince: "2026-09-18T09:00:30.000Z",
          windowSeconds: 60,
        },
        status: "queued",
      },
    ]);
  });

  it("omits a finished or absent clearloop", () => {
    const deferred = sessionQueueSummaries(
      {
        sessionMetadataService: { getMetadata: () => undefined },
        clearloopService: {
          getRunningJob: () => undefined,
          getProgress: () => undefined,
        },
      },
      "session-1",
      undefined,
    );
    expect(deferred).toEqual([]);
  });
});
