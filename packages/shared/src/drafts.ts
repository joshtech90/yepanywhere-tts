import type { StagedAttachmentRef } from "./upload.js";

/** Personal draft slots; resource IDs are YA IDs, never device-local host IDs. */
export interface DraftSlot {
  kind:
    | "session"
    | "new-session"
    | "floating"
    | "handoff"
    | "approval"
    | "question"
    | "async-question"
    | "file-comments";
  sessionId?: string;
  projectId?: string;
  field?: string;
}
export interface DraftPayload {
  /** Stable field IDs let unrelated answers/comments merge independently. */
  fields: Record<string, string>;
  attachments: StagedAttachmentRef[];
}
export interface DraftSnapshot {
  slot: DraftSlot;
  revision: string | null;
  sequence: number;
  payload: DraftPayload;
  updatedAt: number;
}
export interface DraftRead {
  snapshot: DraftSnapshot;
  ticket: string;
}
export interface DraftWrite {
  slot: DraftSlot;
  baseRevision: string | null;
  ticket: string;
  operationId: string;
  payload: DraftPayload;
  /** Preserve the replaced version when reconciling a conflict. */
  recovery?: boolean;
}
export interface DraftWriteResult extends DraftRead {
  outcome: "accepted" | "conflict" | "expired";
  operationId: string;
}
export const EMPTY_DRAFT: DraftPayload = { fields: {}, attachments: [] };
export const DRAFT_MAX_BYTES = 256 * 1024;
export function draftSlotKey(slot: DraftSlot): string {
  return JSON.stringify([
    slot.kind,
    slot.sessionId ?? "",
    slot.projectId ?? "",
    slot.field ?? "",
  ]);
}
export function draftPayloadEqual(a: DraftPayload, b: DraftPayload): boolean {
  const keys = Object.keys(a.fields);
  return (
    keys.length === Object.keys(b.fields).length &&
    keys.every((k) => a.fields[k] === b.fields[k]) &&
    JSON.stringify(a.attachments) === JSON.stringify(b.attachments)
  );
}
export function draftHasContent(payload: DraftPayload): boolean {
  return (
    Object.values(payload.fields).some((value) => value.trim()) ||
    payload.attachments.length > 0
  );
}
/** Conservative three-way field/set merge. No fuzzy text deduplication. */
export function mergeDrafts(
  base: DraftPayload,
  local: DraftPayload,
  remote: DraftPayload,
): DraftPayload {
  const fields: Record<string, string> = {};
  for (const key of new Set([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ])) {
    const b = base.fields[key] ?? "",
      l = local.fields[key] ?? "",
      r = remote.fields[key] ?? "";
    const value =
      l === r || r === b
        ? l
        : l === b
          ? r
          : key.endsWith("/meta")
            ? l || r
            : [r, l].filter(Boolean).join("\n\n");
    if (value) fields[key] = value;
  }
  // A surviving comment must keep its anchor when the other device deleted it.
  for (const key of Object.keys(fields)) {
    if (key.endsWith("/text")) {
      const meta = `${key.slice(0, -5)}/meta`;
      const anchor =
        fields[meta] ??
        local.fields[meta] ??
        remote.fields[meta] ??
        base.fields[meta];
      if (anchor) fields[meta] = anchor;
    } else if (key.endsWith("/meta") && !fields[`${key.slice(0, -5)}/text`])
      delete fields[key];
  }
  const before = new Set(base.attachments.map((a) => a.id));
  const left = new Map(local.attachments.map((a) => [a.id, a]));
  const right = new Map(remote.attachments.map((a) => [a.id, a]));
  const attachments = [
    ...new Map(
      [...remote.attachments, ...local.attachments].map((a) => [a.id, a]),
    ).values(),
  ].filter((a) => !before.has(a.id) || (left.has(a.id) && right.has(a.id)));
  return { fields, attachments };
}
