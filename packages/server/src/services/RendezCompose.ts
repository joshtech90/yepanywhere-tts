import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DraftStore } from "../drafts/DraftStore.js";
import { registerIdleSweep } from "../lib/processIdleSweep.js";
import { getLogger } from "../logging/logger.js";
import type { AttachmentStagingService } from "../uploads/AttachmentStagingService.js";
import {
  RENDEZ_DEFAULT_PROFILE,
  type RendezDeliveryRoute,
  type RendezDraftTarget,
} from "./RendezObserver.js";
import type { RendezWatchService } from "./RendezWatchService.js";
import { atomicJson } from "./rendez-protocol.mjs";
import {
  publishComposeLink,
  RENDEZ_COMPOSE_ROUTE,
} from "./rendezComposeLink.js";

const LEASE_MS = 45_000;
const SLOT = { kind: "new-session" } as const;
interface Claim {
  id: string;
  project: string;
  expires: number;
}

/** One server-owner new-session draft, with one expiring foreground claim. */
export class RendezCompose {
  private claim: Claim | undefined;
  private work: Promise<unknown> = Promise.resolve();
  private closed = false;
  private stopSweep?: () => void;

  constructor(
    private readonly drafts: DraftStore,
    private readonly staging: AttachmentStagingService,
    private readonly watch: () => RendezWatchService | undefined,
    private readonly now = Date.now,
  ) {}

  private startSweep(): void {
    if (this.stopSweep) return;
    this.stopSweep = registerIdleSweep(() => {
      this.work = this.work
        .then(async () => {
          if (
            this.claim &&
            (this.claim.expires <= this.now() ||
              !this.watch()?.enabled(this.claim.project))
          )
            await this.apply(this.claim.id, undefined, false);
        })
        .catch((error) => {
          getLogger().warn(
            { error: String(error) },
            "Rendez compose expiration failed",
          );
        });
    });
  }

  update(
    id: string,
    project: string | undefined,
    acquire: boolean,
  ): Promise<boolean> {
    const result = this.work.then(() => this.apply(id, project, acquire));
    this.work = result.catch(() => undefined);
    return result;
  }

  private async apply(
    id: string,
    project: string | undefined,
    acquire: boolean,
  ): Promise<boolean> {
    if (this.closed) return false;
    const watch = this.watch();
    if (project && !watch?.enabled(project)) {
      if (this.claim?.id !== id) return false;
      project = undefined;
    }
    if (!acquire && this.claim?.id !== id) return false;
    if (
      project &&
      this.claim?.id === id &&
      this.claim.project === project &&
      this.claim.expires > this.now() &&
      watch?.status().watching.includes(project)
    ) {
      this.claim.expires = this.now() + LEASE_MS;
      await publishComposeLink(join(project, ".rendez"), true);
      return true;
    }
    const previous = this.claim;
    this.claim = undefined;
    this.stopSweep?.();
    this.stopSweep = undefined;
    if (previous)
      await publishComposeLink(join(previous.project, ".rendez"), false);
    if (!project) {
      await watch?.setComposeProject(undefined);
      return false;
    }
    try {
      if (!(await watch?.setComposeProject(project))) {
        await watch?.setComposeProject(undefined);
        return false;
      }
      const root = join(project, ".rendez");
      const directory = join(root, "routes", RENDEZ_COMPOSE_ROUTE);
      for (const path of [directory, join(directory, "inbox")]) {
        await mkdir(path, { recursive: true });
        if (!(await lstat(path)).isDirectory())
          throw new Error("Rendez compose route must be a directory");
      }
      const subscription = join(directory, "subscription.json");
      try {
        const previous = JSON.parse(await readFile(subscription, "utf8"));
        if (!previous.target?.draft)
          throw new Error("Rendez compose route already belongs to a session");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await atomicJson(subscription, {
        version: 1,
        project,
        route: RENDEZ_COMPOSE_ROUTE,
        target: { draft: { claimId: id } },
      });
      await publishComposeLink(root, true);
      this.claim = { id, project, expires: this.now() + LEASE_MS };
      this.startSweep();
      return true;
    } catch (error) {
      await watch?.setComposeProject(undefined);
      throw error;
    }
  }

  route(project: string, target: RendezDraftTarget): RendezDeliveryRoute {
    const eligible = () =>
      this.claim?.id === target.draft.claimId &&
      this.claim.project === project &&
      this.claim.expires > this.now() &&
      this.watch()?.enabled(project);
    return {
      transport: "draft",
      profile: RENDEZ_DEFAULT_PROFILE,
      send: async (id, _text, record) => {
        if (!eligible())
          return {
            accepted: false,
            diagnostics: "Rendez compose claim is no longer active",
          };
        if (!record?.path || record.kind === "overload")
          return {
            accepted: false,
            diagnostics:
              "Rendez compose accepts file attachments only; excess uploads remain held",
          };
        const upload = await this.staging.startDraftUpload({
          originalName: record.originalName ?? "upload",
          size: record.size!,
          mimeType: record.mimeType!,
          width: record.width,
          height: record.height,
        });
        let completed = false;
        try {
          for await (const chunk of createReadStream(record.path))
            await this.staging.writeChunk(upload.uploadId, chunk as Buffer);
          const ref = await this.staging.completeUpload(upload.uploadId);
          completed = true;
          if (!eligible()) {
            await this.staging.deleteDraftAttachment(ref.batchId, ref.id);
            return {
              accepted: false,
              diagnostics:
                "Rendez compose claim ended during attachment preparation",
            };
          }
          const current = this.drafts.read("", SLOT);
          if (current.snapshot.payload.attachments.length >= 100)
            throw new Error("Rendez compose draft attachment limit reached");
          const result = this.drafts.write("", {
            slot: SLOT,
            operationId: `rendez-${id}`,
            ticket: current.ticket,
            baseRevision: current.snapshot.revision,
            payload: {
              ...current.snapshot.payload,
              attachments: [...current.snapshot.payload.attachments, ref],
            },
          });
          return {
            accepted: result.outcome === "accepted",
            receipt: { revision: result.snapshot.revision },
          };
        } finally {
          if (!completed) await this.staging.cancelUpload(upload.uploadId);
        }
      },
    };
  }

  async close(): Promise<void> {
    this.stopSweep?.();
    if (this.claim) await this.update(this.claim.id, undefined, false);
    await this.work;
    this.closed = true;
  }
}
