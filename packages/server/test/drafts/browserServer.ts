import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DraftStore } from "../../src/drafts/DraftStore.js";
import { createDraftRoutes } from "../../src/routes/drafts.js";
import { openSqliteOrThrow } from "../../src/storage/sqlite.js";
import { migrateDiscoveryDatabase } from "../../src/storage/discovery-sqlite.js";
import { AttachmentStagingService } from "../../src/uploads/AttachmentStagingService.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import type { SessionAccessResolver } from "../../src/auth/sessionAccess.js";

/** Actual draft HTTP/SQLite boundary; no provider process or personal data. */
export async function startDraftBrowserServer() {
  const dir = await mkdtemp(join(tmpdir(), "ya-draft-browser-"));
  const db = openSqliteOrThrow(join(dir, "drafts.sqlite"));
  migrateDiscoveryDatabase(db);
  const store = new DraftStore(db);
  const staging = new AttachmentStagingService({
    stagingRoot: join(dir, "uploads"),
  });
  staging.setDraftProtection((owner, id) => store.protects(owner ?? "", id));
  const app = new Hono();
  app.get("/api/version", (c) =>
    c.json({ version: "0.9.4", capabilities: ["draft-sync-v1"] }),
  );
  app.get("/api/settings", (c) =>
    c.json({ settings: { limitedUsersEnabled: false } }),
  );
  app.route(
    "/api/drafts",
    createDraftRoutes({
      store,
      staging,
      scanner: {
        getProject: async (id: string) => (id === "history" ? { id } : null),
      } as unknown as ProjectScanner,
      sessions: {
        resolve: async (id: string) =>
          /^draft-history-\d+$/.test(id) ? { projectId: "history" } : null,
      } as unknown as SessionAccessResolver,
    }),
  );
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening)
    await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    store,
    close: async () => {
      if ("closeAllConnections" in server) server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      store.close();
      db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
