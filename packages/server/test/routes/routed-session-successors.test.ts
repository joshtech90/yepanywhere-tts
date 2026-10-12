import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionsRoutes,
  type SessionsDeps,
} from "../../src/routes/sessions.js";
import {
  closeTestDiscoveryDatabases,
  createTestSessionMetadataService,
} from "../utils/session-metadata-database.js";

let dataDir: string | undefined;
afterEach(async () => {
  closeTestDiscoveryDatabases();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

/**
 * Successors that start a fresh session (restart, handoff, title helper) or
 * call the provider directly (fork with summary) would run without a
 * router-pinned source's pin, on the owner's direct login, so they refuse
 * with 409 before doing any work. Fork and clone copies inherit the pin.
 */
describe("routed session successors", () => {
  it.each([
    ["fork-summary", {}, /Fork with summary/],
    ["stale-handoff", {}, /Handoff/],
    ["restart", { restartMode: "handoff" }, /Restart and handoff/],
    ["retitle", {}, /Title generation/],
  ])(
    "refuses %s with 409 and touches nothing",
    async (route, body, message) => {
      dataDir = await mkdtemp(join(tmpdir(), "routed-successors-"));
      const metadata = createTestSessionMetadataService(dataDir);
      await metadata.initialize();
      await metadata.updateMetadata("routed", {
        routerBinding: {
          id: "binding",
          routerId: "router",
          accountId: "account",
          provider: "claude",
        },
      });
      const untouched = new Proxy(
        {},
        {
          get: (_target, property) =>
            vi.fn(() => {
              throw new Error(`unexpected ${String(property)} call`);
            }),
        },
      );
      const routes = createSessionsRoutes({
        supervisor: untouched,
        scanner: untouched,
        sessionMetadataService: metadata,
      } as unknown as SessionsDeps);

      const response = await routes.request(
        `/projects/cHJvamVjdA/sessions/routed/${route}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(message);

      // Control: an unpinned session gets past the guard into the real route.
      const unpinned = await routes.request(
        `/projects/cHJvamVjdA/sessions/unpinned/${route}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      expect(unpinned.status).not.toBe(409);
    },
  );
});
