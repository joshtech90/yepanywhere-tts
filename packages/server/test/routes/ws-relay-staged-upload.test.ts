import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RelayUploadComplete,
  RelayUploadError,
  YepMessage,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type RelayUploadState,
  cleanupUploads,
  createConnectionState,
  draftStagingOwnerForConnection,
  handleStagedUploadStart,
  handleUploadChunk,
  handleUploadEnd,
} from "../../src/routes/ws-relay-handlers.js";
import {
  AttachmentStagingService,
  UploadManager,
} from "../../src/uploads/index.js";

describe("WS relay staged uploads", () => {
  let testDir: string;
  let uploadManager: UploadManager;
  let stagingService: AttachmentStagingService;
  let uploads: Map<string, RelayUploadState>;
  let messages: YepMessage[];

  const send = (msg: YepMessage): void => {
    messages.push(msg);
  };

  beforeEach(() => {
    testDir = join(tmpdir(), `relay-staged-upload-${randomUUID()}`);
    uploadManager = new UploadManager({ uploadsDir: join(testDir, "uploads") });
    stagingService = new AttachmentStagingService({
      stagingRoot: join(testDir, "staging"),
    });
    uploads = new Map();
    messages = [];
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("completes staged uploads as staged refs", async () => {
    const uploadId = "client-upload-a";

    await handleStagedUploadStart(
      uploads,
      {
        type: "staged_upload_start",
        uploadId,
        batchId: "batch-a",
        filename: "draft.txt",
        size: 5,
        mimeType: "text/plain",
      },
      send,
      stagingService,
    );
    await handleUploadChunk(
      uploads,
      {
        type: "upload_chunk",
        uploadId,
        offset: 0,
        data: Buffer.from("hello").toString("base64"),
      },
      send,
      uploadManager,
      stagingService,
    );
    await handleUploadEnd(
      uploads,
      { type: "upload_end", uploadId },
      send,
      uploadManager,
      stagingService,
    );

    const complete = messages.find(
      (msg): msg is RelayUploadComplete => msg.type === "upload_complete",
    );
    expect(complete).toBeDefined();
    if (!complete?.stagedRef) {
      throw new Error("Expected staged upload completion");
    }
    expect(complete?.file).toBeUndefined();
    expect(complete.batchId).toBe("batch-a");
    expect(complete.stagedRef).toMatchObject({
      batchId: "batch-a",
      originalName: "draft.txt",
      size: 5,
      mimeType: "text/plain",
    });
    await expect(
      stagingService.listDraftAttachments("batch-a"),
    ).resolves.toEqual([complete.stagedRef]);
    expect(uploads.size).toBe(0);
  });

  it("rejects staged upload starts when staging is unavailable", async () => {
    await handleStagedUploadStart(
      uploads,
      {
        type: "staged_upload_start",
        uploadId: "client-upload-a",
        filename: "draft.txt",
        size: 5,
        mimeType: "text/plain",
      },
      send,
      undefined,
    );

    expect(messages).toEqual([
      {
        type: "upload_error",
        uploadId: "client-upload-a",
        error: "Attachment staging is unavailable",
      } satisfies RelayUploadError,
    ]);
    expect(uploads.size).toBe(0);
  });

  it("cancels staged uploads on relay disconnect cleanup", async () => {
    const uploadId = "client-upload-a";

    await handleStagedUploadStart(
      uploads,
      {
        type: "staged_upload_start",
        uploadId,
        batchId: "batch-a",
        filename: "draft.txt",
        size: 5,
        mimeType: "text/plain",
      },
      send,
      stagingService,
    );
    await handleUploadChunk(
      uploads,
      {
        type: "upload_chunk",
        uploadId,
        offset: 0,
        data: Buffer.from("hello").toString("base64"),
      },
      send,
      uploadManager,
      stagingService,
    );

    await cleanupUploads(uploads, uploadManager, stagingService);

    expect(uploads.size).toBe(0);
    await expect(
      stagingService.listDraftAttachments("batch-a"),
    ).resolves.toEqual([]);
  });

  it("stages the owner's relay uploads in the superuser's own store", () => {
    const connection = (username: string | null, srp: boolean) => ({
      ...createConnectionState({ transport: "relay" }),
      ...(srp
        ? {
            authState: "authenticated" as const,
            sessionKey: new Uint8Array(32),
          }
        : {}),
      username,
    });

    // The tunneled routes read the owner's relay identity as the superuser,
    // so drafts they validate and queue must live in the root store.
    expect(
      draftStagingOwnerForConnection(connection("owner", true), "owner"),
    ).toBeNull();
    expect(
      draftStagingOwnerForConnection(connection("alice", true), "owner"),
    ).toBe("alice");
    // An identity still awaiting its proof names no account.
    expect(
      draftStagingOwnerForConnection(connection("owner", false), "owner"),
    ).toBeNull();
    expect(
      draftStagingOwnerForConnection(
        { ...connection(null, false), directLoginUsername: "alice" },
        "alice",
      ),
    ).toBe("alice");
  });
});
