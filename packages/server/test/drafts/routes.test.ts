import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { Hono } from "hono";
import { EMPTY_LIMITED_USER_GRANTS } from "@yep-anywhere/shared";
import { createDraftRoutes } from "../../src/routes/drafts.js";
import { DraftStore } from "../../src/drafts/DraftStore.js";
import {
  openSqliteOrThrow,
  type SqliteDatabase,
} from "../../src/storage/sqlite.js";
import { migrateDiscoveryDatabase } from "../../src/storage/discovery-sqlite.js";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import type { AttachmentStagingService } from "../../src/uploads/AttachmentStagingService.js";
import type { SessionAccessResolver } from "../../src/auth/sessionAccess.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
let store: DraftStore, db: SqliteDatabase, app: Hono, principal: Principal;
beforeEach(() => {
  db = openSqliteOrThrow(":memory:");
  migrateDiscoveryDatabase(db);
  store = new DraftStore(db);
  principal = { kind: "superuser" };
  app = new Hono();
  app.use("*", async (c, next) => {
    c.set(PRINCIPAL_VARIABLE, principal);
    await next();
  });
  app.route(
    "/api/drafts",
    createDraftRoutes({
      store,
      scanner: {
        getProject: async (id: string) => (id === "project" ? { id } : null),
      } as ProjectScanner,
      sessions: {
        resolve: async (id: string) =>
          id === "session" ? { projectId: "project" } : null,
      } as SessionAccessResolver,
      staging: {
        forUser: () => ({ validateDraftRefs: async () => [] }),
      } as unknown as AttachmentStagingService,
    }),
  );
});
afterEach(() => {
  store.close();
  db.close();
});
const post = (route: string, body: unknown) =>
  app.request(`/api/drafts/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("authenticated personal draft routes", () => {
  it("isolates principals and checks slot resources instead of trusting body IDs", async () => {
    const slot = { kind: "session", sessionId: "session" };
    const read = await (await post("read", { slot })).json();
    expect(
      (
        await post("write", {
          slot,
          ticket: read.ticket,
          baseRevision: null,
          operationId: "owner-write",
          payload: { fields: { text: "private" }, attachments: [] },
        })
      ).status,
    ).toBe(200);
    principal = {
      kind: "limited",
      username: "alice",
      grants: EMPTY_LIMITED_USER_GRANTS,
      switched: false,
      locked: true,
      via: "direct",
    };
    expect((await post("read", { slot })).status).toBe(404);
    expect(
      (await post("read", { slot: { ...slot, projectId: "other" } })).status,
    ).toBe(404);
    expect(
      (await (await app.request("/api/drafts/index")).json()).entries,
    ).toEqual([]);
    principal = {
      ...principal,
      grants: { ...EMPTY_LIMITED_USER_GRANTS, viewProjects: ["project"] },
    };
    expect(
      (await (await post("read", { slot })).json()).snapshot.payload.fields,
    ).toEqual({});
  });
  it("refuses an attachment reference the acting account cannot validate", async () => {
    const slot = { kind: "new-session" };
    const read = await (await post("read", { slot })).json();
    expect(
      (
        await post("write", {
          slot,
          ticket: read.ticket,
          baseRevision: null,
          operationId: "forged",
          payload: {
            fields: { text: "text" },
            attachments: [{ id: "someone-elses-file", batchId: "batch" }],
          },
        })
      ).status,
    ).toBe(400);
    expect(
      store.read("", slot as { kind: "new-session" }).snapshot.revision,
    ).toBeNull();
  });
  it("publishes a change only after a committed accepted write", async () => {
    const seq = store.sequence();
    const waiting = app.request(`/api/drafts/changes?after=${seq}`);
    const slot = { kind: "new-session" };
    const read = await (await post("read", { slot })).json();
    await post("write", {
      slot,
      ticket: read.ticket,
      baseRevision: null,
      operationId: "change",
      payload: { fields: { text: "saved" }, attachments: [] },
    });
    expect((await (await waiting).json()).sequence).toBeGreaterThan(seq);
  });
});
