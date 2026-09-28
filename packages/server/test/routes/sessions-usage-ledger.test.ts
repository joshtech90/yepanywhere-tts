import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserUsageService } from "../../src/auth/UserUsageService.js";
import {
  type SessionsDeps,
  createSessionsRoutes,
} from "../../src/routes/sessions.js";
import type { ISessionReader } from "../../src/sessions/types.js";
import type { Process } from "../../src/supervisor/Process.js";
import type { Project } from "../../src/supervisor/types.js";

/**
 * Every route that starts a session or accepts a user turn writes its usage
 * record. Contract: topics/limited-users.md § Usage.
 */

const projectId = "tmp-usage-project" as UrlProjectId;

function createProject(): Project {
  return {
    id: projectId,
    path: "/tmp/usage-project",
    name: "usage-project",
    sessionCount: 1,
    sessionDir: "/tmp/usage-project/.sessions",
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
    provider: "claude",
  };
}

function createProcess(sessionId: string): Process {
  return {
    id: `process-${sessionId}`,
    sessionId,
    projectId,
    permissionMode: "default",
    modeVersion: 0,
    promptSuggestionMode: "off",
    recapAfterSeconds: 300,
  } as unknown as Process;
}

describe("Usage records on the session routes", () => {
  let dir: string;
  let userUsageService: UserUsageService;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ya-usage-routes-"));
    userUsageService = new UserUsageService({ dataDir: dir });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function createRoutes(supervisor: Record<string, unknown>) {
    const project = createProject();
    return createSessionsRoutes({
      supervisor: supervisor as unknown as SessionsDeps["supervisor"],
      scanner: {
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: vi.fn(
        () =>
          ({
            getSessionSummary: vi.fn(async () => null),
          }) as unknown as ISessionReader,
      ),
      sessionMetadataService: {
        getMetadata: vi.fn(() => undefined),
        getProvider: vi.fn(() => "claude"),
        getRequestedModel: vi.fn(() => undefined),
        getExecutor: vi.fn(() => undefined),
        forkLineageRoot: vi.fn(() => "sess-1"),
        nextForkOrdinal: vi.fn(async () => ({
          ordinal: 1,
          lineageRootId: "sess-1",
        })),
        setProvider: vi.fn(async () => undefined),
        setExecutor: vi.fn(async () => undefined),
        setInitialPrompt: vi.fn(async () => undefined),
        setRequestedModel: vi.fn(async () => undefined),
        setSessionSandbox: vi.fn(async () => undefined),
        updateMetadata: vi.fn(async () => undefined),
      } as unknown as NonNullable<SessionsDeps["sessionMetadataService"]>,
      userUsageService,
    });
  }

  const post = (
    routes: ReturnType<typeof createRoutes>,
    url: string,
    body: unknown,
  ) =>
    routes.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  async function superuserTotals() {
    const report = await userUsageService.report();
    return report.users.find((user) => user.username === null)?.total;
  }

  it("counts a session started without a project, and its first turn", async () => {
    const routes = createRoutes({
      startSession: vi.fn(async () => createProcess("detached")),
    });

    const response = await post(routes, "/sessions", {
      message: "two words",
    });

    expect(response.status).toBe(200);
    expect(await superuserTotals()).toMatchObject({
      sessions: 1,
      turns: 1,
      words: 2,
    });
  });

  it("counts a session created without a project", async () => {
    const routes = createRoutes({
      createSession: vi.fn(async () => createProcess("detached")),
    });

    const response = await post(routes, "/sessions/create", {});

    expect(response.status).toBe(200);
    expect(await superuserTotals()).toMatchObject({ sessions: 1, turns: 0 });
  });

  it("counts a start the supervisor queues for a worker, not one it refuses", async () => {
    const startSession = vi
      .fn()
      .mockResolvedValueOnce({ queued: true, queueId: "q-1", position: 1 })
      .mockResolvedValueOnce({ error: "queue_full", maxQueueSize: 1 });
    const routes = createRoutes({ startSession });

    const queued = await post(routes, `/projects/${projectId}/sessions`, {
      message: "wait your turn",
    });
    const refused = await post(routes, `/projects/${projectId}/sessions`, {
      message: "no room",
    });

    expect(queued.status).toBe(202);
    expect(refused.status).toBe(503);
    expect(await superuserTotals()).toMatchObject({
      sessions: 1,
      turns: 1,
      words: 3,
    });
  });

  it("counts a fork as a session and nothing else", async () => {
    const routes = createRoutes({
      getProcessForSession: vi.fn(() => undefined),
      supportsForkSession: vi.fn(() => true),
      forkSession: vi.fn(async () => ({ sessionId: "sess-fork" })),
    });

    const response = await post(
      routes,
      `/projects/${projectId}/sessions/sess-1/fork`,
      { upToMessageId: "msg-1" },
    );

    expect(response.status).toBe(200);
    expect(await superuserTotals()).toMatchObject({ sessions: 1, turns: 0 });
  });
});
