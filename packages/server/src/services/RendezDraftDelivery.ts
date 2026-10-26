import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  draftSlotKey,
  type DraftSlot,
  type StagedAttachmentRef,
} from "@yep-anywhere/shared";
import type { DraftStore } from "../drafts/DraftStore.js";
import { runOutsideRequestContext } from "../lib/outsideRequestContext.js";
import { getLogger } from "../logging/logger.js";
import type { AttachmentStagingService } from "../uploads/AttachmentStagingService.js";
import type {
  RendezDeliveryRoute,
  RendezRecord,
  RendezSendResult,
} from "./RendezObserver.js";

interface Pending {
  slot: DraftSlot;
  ref: StagedAttachmentRef;
  text: string;
  send: (text: string) => Promise<RendezSendResult>;
}

/** Stages session uploads in shared drafts; one next-deadline timer owns auto-send. */
export class RendezDraftDelivery {
  // At most 256 uploads can be counting down; held files live only in DraftStore.
  private readonly pending = new Map<string, Pending>();
  // Recent auto-sends reject racing manual materialization, bounded to 512 IDs.
  private readonly sent = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private readonly unsubscribe: () => void;
  private closed = false;
  private work: Promise<void> = Promise.resolve();

  constructor(
    private readonly drafts: DraftStore,
    private readonly staging: AttachmentStagingService,
  ) {
    // Pending callbacks do not survive restart. Reconcile the bounded draft
    // index once so persisted previews never promise an abandoned countdown.
    let after = "";
    for (;;) {
      const page = drafts.list("", after);
      for (const entry of page) {
        if (entry.empty || entry.slot.kind !== "session") continue;
        const current = drafts.read("", entry.slot);
        if (
          !current.snapshot.payload.attachments.some(
            (ref) => typeof ref.rendezAutoSendAt === "number",
          )
        )
          continue;
        drafts.write("", {
          slot: entry.slot,
          operationId: randomUUID(),
          ticket: current.ticket,
          baseRevision: current.snapshot.revision,
          payload: {
            ...current.snapshot.payload,
            attachments: current.snapshot.payload.attachments.map((ref) =>
              typeof ref.rendezAutoSendAt === "number"
                ? { ...ref, rendezAutoSendAt: null }
                : ref,
            ),
          },
        });
      }
      if (page.length < 100) break;
      after = draftSlotKey(page[page.length - 1]!.slot);
    }
    this.unsubscribe = drafts.subscribe("", () => this.reconcile());
  }

  async stage(
    sessionId: string,
    id: string,
    text: string,
    record: RendezRecord | undefined,
    send: RendezDeliveryRoute["send"],
  ): Promise<RendezSendResult> {
    if (!record?.path || record.kind === "overload")
      return send(id, text, record);
    if (this.closed)
      return {
        accepted: false,
        diagnostics: "Rendez draft delivery is closed",
      };
    const slot: DraftSlot = { kind: "session", sessionId };
    const upload = await this.staging.startDraftUpload({
      originalName: record.originalName ?? "upload",
      size: record.size!,
      mimeType: record.mimeType!,
      width: record.width,
      height: record.height,
    });
    let ref: StagedAttachmentRef | undefined;
    let retained = false;
    try {
      for await (const chunk of createReadStream(record.path))
        await this.staging.writeChunk(upload.uploadId, chunk as Buffer);
      ref = await this.staging.completeUpload(upload.uploadId);
      if (this.closed)
        throw new Error("Rendez draft delivery closed during preparation");
      const current = this.drafts.read("", slot);
      if (current.snapshot.payload.attachments.length >= 100)
        throw new Error("Rendez session draft attachment limit reached");
      const hasText = Object.values(current.snapshot.payload.fields).some(
        (value) => value.length > 0,
      );
      const heldAttachments = current.snapshot.payload.attachments.some(
        (attachment) =>
          typeof attachment.rendezAutoSendAt !== "number" ||
          !this.pending.has(attachment.id),
      );
      ref = {
        ...ref,
        rendezPath: record.path,
        rendezAutoSendAt:
          hasText || heldAttachments || this.pending.size >= 256
            ? null
            : Date.now() + 10_000,
      };
      const deadline = ref.rendezAutoSendAt;
      const result = this.drafts.write("", {
        slot,
        operationId: `rendez-${id}`,
        ticket: current.ticket,
        baseRevision: current.snapshot.revision,
        payload: {
          ...current.snapshot.payload,
          attachments: [
            ...current.snapshot.payload.attachments.map((attachment) =>
              typeof attachment.rendezAutoSendAt === "number"
                ? { ...attachment, rendezAutoSendAt: deadline }
                : attachment,
            ),
            ref,
          ],
        },
      });
      retained = result.outcome === "accepted";
      if (retained && ref.rendezAutoSendAt !== null) {
        this.pending.set(ref.id, {
          slot,
          ref,
          text,
          send: (message) => send(id, message, record),
        });
        this.reconcile();
      }
      return {
        accepted: retained,
        receipt: { revision: result.snapshot.revision },
      };
    } finally {
      if (!ref) await this.staging.cancelUpload(upload.uploadId);
      else if (!retained)
        await this.staging.deleteDraftAttachment(ref.batchId, ref.id);
    }
  }

  private replace(item: Pending, ref: StagedAttachmentRef | undefined): void {
    const current = this.drafts.read("", item.slot);
    const attachments = current.snapshot.payload.attachments.flatMap((a) =>
      a.id === item.ref.id ? (ref ? [ref] : []) : [a],
    );
    if (ref && !attachments.some((a) => a.id === ref.id)) attachments.push(ref);
    this.drafts.write("", {
      slot: item.slot,
      operationId: randomUUID(),
      ticket: current.ticket,
      baseRevision: current.snapshot.revision,
      payload: { ...current.snapshot.payload, attachments },
    });
  }

  claim(refs: readonly StagedAttachmentRef[]): void {
    if (refs.some((ref) => this.sent.has(ref.id)))
      throw new Error(
        "Rendez attachment missing or invalid: already auto-sent",
      );
    for (const ref of refs) {
      const item = this.pending.get(ref.id);
      if (!item) continue;
      this.pending.delete(ref.id);
      this.replace(item, { ...item.ref, rendezAutoSendAt: null });
    }
    this.schedule();
  }

  private reconcile(): void {
    for (const [id, item] of this.pending) {
      const payload = this.drafts.read("", item.slot).snapshot.payload;
      const ref = payload.attachments.find((a) => a.id === id);
      if (
        !ref ||
        ref.rendezAutoSendAt === null ||
        payload.attachments.some(
          (attachment) => attachment.rendezPath === undefined,
        ) ||
        Object.values(payload.fields).some((value) => value.length > 0)
      ) {
        this.pending.delete(id);
        if (ref && ref.rendezAutoSendAt !== null)
          this.replace(item, { ...ref, rendezAutoSendAt: null });
      } else {
        item.ref = ref;
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.closed || !this.pending.size) return;
    const next = Math.min(
      ...[...this.pending.values()].map((item) => item.ref.rendezAutoSendAt!),
    );
    this.timer = runOutsideRequestContext(() =>
      setTimeout(
        () => {
          this.timer = undefined;
          this.work = this.work
            .then(() => this.deliver())
            .catch((error) =>
              getLogger().warn(
                { error: String(error) },
                "Rendez draft auto-send failed",
              ),
            );
        },
        Math.max(0, next - Date.now()),
      ),
    );
    this.timer.unref();
  }

  private async deliver(): Promise<void> {
    this.reconcile();
    for (const item of [...this.pending.values()]) {
      if (
        this.closed ||
        !this.pending.has(item.ref.id) ||
        item.ref.rendezAutoSendAt! > Date.now()
      )
        continue;
      const group = [...this.pending.values()].filter(
        (candidate) => draftSlotKey(candidate.slot) === draftSlotKey(item.slot),
      );
      if (!group.length) continue;
      // Remove synchronously before yielding: manual send and auto-send cannot
      // both consume the same draft reference on the server event loop.
      for (const member of group) {
        this.pending.delete(member.ref.id);
        this.sent.add(member.ref.id);
        if (this.sent.size > 512)
          this.sent.delete(this.sent.values().next().value!);
        this.replace(member, undefined);
      }
      try {
        const result = await group[group.length - 1]!.send(
          group.map((member) => member.text).join("\n\n"),
        );
        if (!result.accepted)
          throw new Error(
            result.diagnostics ?? "Rendez target refused auto-send",
          );
      } catch (error) {
        for (const member of group) {
          this.sent.delete(member.ref.id);
          this.replace(member, { ...member.ref, rendezAutoSendAt: null });
        }
        getLogger().warn(
          { error: String(error) },
          "Rendez upload retained in draft after auto-send failure",
        );
      }
    }
    this.schedule();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribe();
    if (this.timer) clearTimeout(this.timer);
    for (const item of this.pending.values())
      this.replace(item, { ...item.ref, rendezAutoSendAt: null });
    this.pending.clear();
    await this.work;
  }
}
