import { Hono, type Context } from "hono";
import {
  DRAFT_MAX_BYTES,
  draftSlotKey,
  projectAccessLevel,
  type DraftSlot,
  type DraftPayload,
  type DraftWrite,
  type StagedAttachmentRef,
} from "@yep-anywhere/shared";
import { principalFor, actingUsername } from "../auth/limitedLaunchPolicy.js";
import type { SessionAccessResolver } from "../auth/sessionAccess.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { AttachmentStagingService } from "../uploads/AttachmentStagingService.js";
import type { DraftStore } from "../drafts/DraftStore.js";

const kinds = new Set([
  "session",
  "new-session",
  "floating",
  "handoff",
  "approval",
  "question",
  "async-question",
  "file-comments",
]);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseDraftSlot(value: unknown): DraftSlot {
  if (
    !record(value) ||
    typeof value.kind !== "string" ||
    !kinds.has(value.kind)
  )
    throw new Error("Invalid draft slot");
  for (const [k, v] of Object.entries(value))
    if (
      !["kind", "sessionId", "projectId", "field"].includes(k) ||
      typeof v !== "string" ||
      !v ||
      v.length > 4096
    )
      throw new Error("Invalid draft slot field");
  if (!["new-session", "floating"].includes(value.kind) && !value.sessionId)
    throw new Error("Draft requires a session");
  return value as unknown as DraftSlot;
}
function parsePayload(value: unknown): DraftPayload {
  if (
    !record(value) ||
    !record(value.fields) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > 100
  )
    throw new Error("Invalid draft payload");
  if (
    Object.keys(value.fields).length > 256 ||
    Object.entries(value.fields).some(
      ([k, v]) => k.length > 4096 || typeof v !== "string",
    )
  )
    throw new Error("Invalid draft fields");
  if (
    value.attachments.some(
      (a) =>
        !record(a) || typeof a.id !== "string" || typeof a.batchId !== "string",
    )
  )
    throw new Error("Invalid attachment references");
  if (Buffer.byteLength(JSON.stringify(value)) > DRAFT_MAX_BYTES)
    throw new Error("Draft exceeds 256 KiB");
  return value as unknown as DraftPayload;
}
export function createDraftRoutes(deps: {
  store: DraftStore;
  staging: AttachmentStagingService;
  scanner: ProjectScanner;
  sessions: SessionAccessResolver;
}): Hono {
  const routes = new Hono();
  const owner = (c: Context) => actingUsername(c) ?? "";
  async function authorized(c: Context, slot: DraftSlot): Promise<boolean> {
    let project = slot.projectId;
    if (slot.sessionId) {
      const facts = await deps.sessions.resolve(slot.sessionId);
      if (!facts) return false;
      if (project && project !== facts.projectId) return false;
      project = facts.projectId;
    }
    if (project && !(await deps.scanner.getProject(project))) return false;
    const principal = principalFor(c);
    return (
      principal.kind === "superuser" ||
      !project ||
      projectAccessLevel(principal.grants, project) !== "none"
    );
  }
  routes.onError((error, c) => c.json({ error: error.message }, 400));
  routes.post("/read", async (c) => {
    const slot = parseDraftSlot((await c.req.json()).slot);
    if (!(await authorized(c, slot)))
      return c.json({ error: "Draft context not found" }, 404);
    return c.json({
      ...deps.store.read(owner(c), slot),
      recovery: deps.store.recovery(owner(c), slot),
    });
  });
  routes.get("/index", async (c) => {
    const entries = deps.store.list(owner(c), c.req.query("after") ?? "");
    const visible = [];
    for (const entry of entries)
      if (await authorized(c, entry.slot)) visible.push(entry);
    return c.json({
      entries: visible,
      next:
        entries.length === 100
          ? draftSlotKey(entries[entries.length - 1]!.slot)
          : null,
      owner: owner(c),
      sequence: deps.store.sequence(owner(c)),
    });
  });
  const write = (clear: boolean) => async (c: Context) => {
    const body = await c.req.json();
    const slot = parseDraftSlot(body.slot);
    if (!(await authorized(c, slot)))
      return c.json({ error: "Draft context not found" }, 404);
    if (
      typeof body.operationId !== "string" ||
      body.operationId.length > 128 ||
      !body.operationId ||
      typeof body.ticket !== "string" ||
      body.ticket.length > 256 ||
      (body.baseRevision !== null && typeof body.baseRevision !== "string")
    )
      throw new Error("Invalid draft operation");
    const payload = clear
      ? { fields: {}, attachments: [] }
      : parsePayload(body.payload);
    // Canonical server records validate account ownership and physical existence.
    const staging = deps.staging.forUser(actingUsername(c) ?? null);
    const refs: StagedAttachmentRef[] = [];
    for (const batch of new Set(payload.attachments.map((a) => a.batchId))) {
      const group = payload.attachments.filter((a) => a.batchId === batch);
      const valid = await staging.validateDraftRefs(batch, group);
      if (valid.length !== group.length)
        throw new Error("Draft attachment missing or invalid");
      refs.push(...valid);
    }
    const write: DraftWrite = {
      slot,
      baseRevision: body.baseRevision,
      ticket: body.ticket,
      operationId: body.operationId,
      payload: {
        fields: payload.fields,
        attachments: payload.attachments.map(
          (ref) => refs.find((valid) => valid.id === ref.id)!,
        ),
      },
      recovery: body.recovery === true || clear,
    };
    return c.json(deps.store.write(owner(c), write));
  };
  routes.post("/write", write(false));
  routes.post("/clear", write(true));
  // One bounded long-poll per connected source/account, never one per draft.
  routes.get("/changes", async (c) => {
    const sequence = Number(c.req.query("after") ?? -1);
    let latest = deps.store.sequence(owner(c));
    if (sequence === latest)
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          latest = deps.store.sequence(owner(c));
          clearTimeout(timer);
          unsubscribe();
          c.req.raw.signal.removeEventListener("abort", finish);
          resolve();
        };
        const unsubscribe = deps.store.subscribe(owner(c), finish);
        const timer = setTimeout(finish, 10_000);
        c.req.raw.signal.addEventListener("abort", finish, { once: true });
        if (c.req.raw.signal.aborted) finish();
      });
    return c.json({ sequence: latest });
  });
  return routes;
}
