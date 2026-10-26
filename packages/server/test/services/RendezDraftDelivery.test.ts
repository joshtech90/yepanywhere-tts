import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { DraftStore } from "../../src/drafts/DraftStore.js";
import { openSqliteOrThrow } from "../../src/storage/sqlite.js";
import { migrateDiscoveryDatabase } from "../../src/storage/discovery-sqlite.js";
import { AttachmentStagingService } from "../../src/uploads/AttachmentStagingService.js";
import { RendezDraftDelivery } from "../../src/services/RendezDraftDelivery.js";
import type { RendezRecord } from "../../src/services/RendezObserver.js";

it("stages uploads beside existing text, cancels on typing, and arbitrates manual/automatic sends", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rendez-draft-"));
  const db = openSqliteOrThrow(":memory:");
  migrateDiscoveryDatabase(db);
  const drafts = new DraftStore(db);
  const staging = new AttachmentStagingService({ dataDir: directory });
  staging.setDraftProtection((owner, id) => drafts.protects(owner ?? "", id));
  const delivery = new RendezDraftDelivery(drafts, staging);
  const slot = { kind: "session", sessionId: "receiver" } as const;
  const read = () => drafts.read("", slot);
  const clear = () => {
    const current = read();
    drafts.write("", {
      slot,
      operationId: randomUUID(),
      ticket: current.ticket,
      baseRevision: current.snapshot.revision,
      payload: { fields: {}, attachments: [] },
    });
  };
  const edit = (text: string) => {
    const current = read();
    return drafts.write("", {
      slot,
      operationId: randomUUID(),
      ticket: current.ticket,
      baseRevision: current.snapshot.revision,
      payload: { ...current.snapshot.payload, fields: { text } },
    });
  };
  const send = vi.fn(async () => ({ accepted: true }));
  const path = join(directory, "screenshot.txt");
  await writeFile(path, "bytes");
  const upload = async () => {
    const id = randomUUID();
    const record: RendezRecord = {
      version: 1,
      id,
      route: "receiver",
      target: {
        harness: "codex",
        providerSessionId: "receiver",
        yaSessionId: "receiver",
      },
      state: "pending",
      createdAt: Date.now(),
      originalName: "screenshot.txt",
      path,
      size: 5,
      mimeType: "text/plain",
    };
    expect(
      await delivery.stage("receiver", id, "upload text", record, send),
    ).toMatchObject({ accepted: true });
    return read().snapshot.payload.attachments.at(-1)!;
  };
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  try {
    edit("A draft already begun");
    const existing = await upload();
    expect(existing.rendezAutoSendAt).toBeNull();
    expect(read().snapshot.payload.fields.text).toBe("A draft already begun");
    await vi.advanceTimersByTimeAsync(11_000);
    expect(send).not.toHaveBeenCalled();

    clear();
    const held = await upload();
    expect(held.rendezAutoSendAt).toBe(Date.now() + 10_000);
    await vi.advanceTimersByTimeAsync(3000);
    const second = await upload();
    expect(
      read()
        .snapshot.payload.attachments.filter(
          (a) => a.id === held.id || a.id === second.id,
        )
        .map((a) => a.rendezAutoSendAt),
    ).toEqual([Date.now() + 10_000, Date.now() + 10_000]);
    await vi.advanceTimersByTimeAsync(9000);
    edit("new text");
    edit("");
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).not.toHaveBeenCalled();
    expect(
      read().snapshot.payload.attachments.find((a) => a.id === held.id)
        ?.rendezAutoSendAt,
    ).toBeNull();

    clear();
    await upload();
    await vi.advanceTimersByTimeAsync(9999);
    delivery.claim(read().snapshot.payload.attachments);
    clear();
    await vi.advanceTimersByTimeAsync(2);
    expect(send).not.toHaveBeenCalled();

    const automatic = await upload();
    await vi.advanceTimersByTimeAsync(3000);
    const automaticSecond = await upload();
    await vi.advanceTimersByTimeAsync(9999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      "upload text\n\nupload text",
      expect.objectContaining({ path }),
    );
    expect(
      read().snapshot.payload.attachments.some((a) => a.id === automatic.id),
    ).toBe(false);
    expect(() => delivery.claim([automatic])).toThrow("already auto-sent");
    expect(() => delivery.claim([automaticSecond])).toThrow(
      "already auto-sent",
    );
    expect(
      await staging.validateDraftRefs(existing.batchId, [existing]),
    ).toHaveLength(1);

    send.mockResolvedValueOnce({ accepted: false });
    const failed = await upload();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      read().snapshot.payload.attachments.find((a) => a.id === failed.id)
        ?.rendezAutoSendAt,
    ).toBeNull();

    clear();
    const alongsideBrowserUpload = await upload();
    const ordinary = { ...existing };
    delete ordinary.rendezPath;
    delete ordinary.rendezAutoSendAt;
    const withBrowserUpload = read();
    drafts.write("", {
      slot,
      operationId: randomUUID(),
      ticket: withBrowserUpload.ticket,
      baseRevision: withBrowserUpload.snapshot.revision,
      payload: {
        ...withBrowserUpload.snapshot.payload,
        attachments: [
          ...withBrowserUpload.snapshot.payload.attachments,
          ordinary,
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      read().snapshot.payload.attachments.find(
        (ref) => ref.id === alongsideBrowserUpload.id,
      )?.rendezAutoSendAt,
    ).toBeNull();
    clear();
    const closing = await upload();
    await delivery.close();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      read().snapshot.payload.attachments.find((a) => a.id === closing.id)
        ?.rendezAutoSendAt,
    ).toBeNull();
    // Simulate a crash that persisted an active deadline without its callback.
    const stale = read();
    drafts.write("", {
      slot,
      ticket: stale.ticket,
      baseRevision: stale.snapshot.revision,
      operationId: randomUUID(),
      payload: {
        ...stale.snapshot.payload,
        attachments: stale.snapshot.payload.attachments.map((ref) =>
          ref.id === closing.id
            ? { ...ref, rendezAutoSendAt: Date.now() + 10_000 }
            : ref,
        ),
      },
    });
    const recovered = new RendezDraftDelivery(drafts, staging);
    try {
      expect(
        read().snapshot.payload.attachments.at(-1)?.rendezAutoSendAt,
      ).toBeNull();
      await vi.advanceTimersByTimeAsync(11_000);
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      await recovered.close();
    }
  } finally {
    await delivery.close();
    vi.useRealTimers();
    drafts.close();
    db.close();
    await rm(directory, { recursive: true });
  }
});
