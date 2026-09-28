import { describe, expect, it } from "vitest";
import {
  PROJECT_QUEUE_SESSION_BLOCKER_REASONS,
  parseProjectQueueBlocker,
  projectQueueLivenessBlocker,
  projectQueueSessionBlocker,
} from "../project-queue.js";

describe("project queue blockers", () => {
  it("reads back every session reason the server writes", () => {
    for (const reason of PROJECT_QUEUE_SESSION_BLOCKER_REASONS) {
      expect(
        parseProjectQueueBlocker(projectQueueSessionBlocker("s-1", reason)),
      ).toEqual({ kind: "session", sessionId: "s-1", reason });
    }
    expect(
      parseProjectQueueBlocker(
        projectQueueLivenessBlocker("s-1", "verified-progressing"),
      ),
    ).toEqual({
      kind: "session-liveness",
      sessionId: "s-1",
      status: "verified-progressing",
    });
  });

  it("reads the project-wide blockers", () => {
    expect(parseProjectQueueBlocker("readiness:Editing parser: tests")).toEqual(
      { kind: "readiness", detail: "Editing parser: tests" },
    );
    expect(parseProjectQueueBlocker("worker-queue")).toEqual({
      kind: "worker-queue",
    });
    expect(parseProjectQueueBlocker("project-queue:first-failed")).toEqual({
      kind: "first-item-failed",
    });
    expect(parseProjectQueueBlocker("recovered-session-queue:2")).toEqual({
      kind: "recovered-session-queue",
      count: "2",
    });
  });

  it("keeps a blocker it does not know whole", () => {
    expect(parseProjectQueueBlocker("s-1:some-future-reason")).toEqual({
      kind: "other",
      blocker: "s-1:some-future-reason",
    });
    expect(parseProjectQueueBlocker("project-queue:item-waiting")).toEqual({
      kind: "other",
      blocker: "project-queue:item-waiting",
    });
  });
});
