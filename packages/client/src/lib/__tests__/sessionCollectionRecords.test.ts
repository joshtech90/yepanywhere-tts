import { describe, expect, it } from "vitest";
import type { SessionCollectionRecord } from "../clientSummaryCollections";
import { sessionCollectionRecordToGlobalSessionItem } from "../sessionCollectionRecords";

describe("sessionCollectionRecordToGlobalSessionItem", () => {
  it("keeps an unknown creation time absent instead of copying activity time", () => {
    const record: SessionCollectionRecord = {
      id: "session",
      updatedAt: "2026-09-21T09:00:00.000Z",
      provider: "claude",
      projectId: "project",
      observedAt: 0,
    };

    expect(sessionCollectionRecordToGlobalSessionItem(record)).toMatchObject({
      id: "session",
      updatedAt: "2026-09-21T09:00:00.000Z",
      createdAt: undefined,
    });
  });
});
