import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";
import { getEntry, openDatabase, putEntryWithKey } from "../diagnostics/idb";
import { loadCachedAttachmentPreview } from "../attachmentPreviewCache";

// Its own file so the version 2 database exists before the module opens it.
const DB_NAME = "yep-anywhere-attachment-previews";

describe("attachment preview cache upgrade", () => {
  it("moves version 2 inline blobs out of the access-time record", async () => {
    const attachmentId = "attachment-id-inline";
    const v2 = await openDatabase(DB_NAME, 2, (db) => {
      const store = db.createObjectStore("images");
      store.createIndex("byLastAccessedAt", "lastAccessedAt");
    });
    await putEntryWithKey(v2, "images", attachmentId, {
      attachmentId,
      path: "/project/.attachments/session/inline.png",
      originalName: "inline.png",
      mimeType: "image/png",
      size: 4,
      thumbnailVariant: "stale",
      thumbnailWidth: 1,
      thumbnailHeight: 1,
      thumbnailBlob: new Blob(["thumb"], { type: "image/png" }),
      fullBlob: new Blob(["full"], { type: "image/png" }),
      totalBytes: 9,
      createdAt: 1,
      lastAccessedAt: 1,
    });
    v2.close();

    const loaded = await loadCachedAttachmentPreview(attachmentId);

    expect(loaded).toMatchObject({ attachmentId, totalBytes: 9 });
    expect(loaded).toHaveProperty("fullBlob");
    const v3 = await openDatabase(DB_NAME, 3, () => {});
    const record = await getEntry<Record<string, unknown>>(
      v3,
      "images",
      attachmentId,
    );
    expect(record).toMatchObject({ attachmentId, totalBytes: 9 });
    expect(record).not.toHaveProperty("fullBlob");
    expect(record).not.toHaveProperty("thumbnailBlob");
    const blobs = await getEntry(v3, "blobs", attachmentId);
    expect(blobs).toHaveProperty("fullBlob");
    expect(blobs).toHaveProperty("thumbnailBlob");
    v3.close();
  });
});
