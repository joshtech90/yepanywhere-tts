import type { UrlProjectId, WorkstreamId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMetadataService } from "../../src/metadata/index.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createSessionsRoutes } from "../../src/routes/sessions.js";
import type { ServerSettingsService } from "../../src/services/ServerSettingsService.js";
import type { WorkstreamService } from "../../src/services/WorkstreamService.js";
import type { Process } from "../../src/supervisor/Process.js";
import type {
  SessionLaunchOptions,
  Supervisor,
} from "../../src/supervisor/Supervisor.js";
import type { Project } from "../../src/supervisor/types.js";

const projectId = "proj-workstream" as UrlProjectId;
const workstreamId = "ws-lane" as WorkstreamId;
const projectPath = "/repo/main";
const checkoutPath = "/data/checkouts/repo/ws-lane";
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

function createProject(): Project {
  return {
    id: projectId,
    path: projectPath,
    name: "repo",
    sessionCount: 0,
    sessionDir: "/sessions/repo",
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

function createDeps() {
  const project = createProject();
  const scanner = {
    getOrCreateProject: vi.fn(async (id: UrlProjectId) =>
      id === projectId ? project : null,
    ),
  } as unknown as ProjectScanner;
  const serverSettingsService = {
    getSetting: vi.fn((key: string) =>
      key === "workstreamsEnabled" ? true : undefined,
    ),
  } as unknown as ServerSettingsService;
  const workstreamService = {
    getWorkstream: vi.fn((requestedProjectId, requestedWorkstreamId) =>
      requestedProjectId === projectId && requestedWorkstreamId === workstreamId
        ? {
            id: workstreamId,
            projectId,
            label: "lane",
            kind: "checkout",
            path: checkoutPath,
            branch: "main",
            baseBranch: "main",
            baseCommit: null,
            managedByYa: true,
            queuePaused: false,
            status: "active",
            createdAt: "2026-07-05T10:00:00.000Z",
            updatedAt: "2026-07-05T10:00:00.000Z",
          }
        : null,
    ),
  } as unknown as WorkstreamService;
  const sessionMetadataService = {
    getMetadata: vi.fn(() => undefined),
    setProvider: vi.fn(async () => {}),
    setExecutor: vi.fn(async () => {}),
    setInitialPrompt: vi.fn(async () => {}),
    setRequestedModel: vi.fn(async () => {}),
    updateMetadata: vi.fn(async () => {}),
    setWorkstream: vi.fn(async () => {}),
    recordCreationProvenance: vi.fn(async () => {}),
  } as unknown as SessionMetadataService;
  // Like the Supervisor, an immediate launch runs its onStarted before
  // returning the process.
  const startNow = async (
    sessionId: string,
    options: SessionLaunchOptions | undefined,
  ) => {
    const process = createProcess(sessionId);
    await options?.onStarted?.(sessionId, process);
    return process;
  };
  const supervisor = {
    startSession: vi.fn(
      async (
        _path: string,
        _message: unknown,
        _mode: unknown,
        _settings: unknown,
        options?: SessionLaunchOptions,
      ) => startNow("session-started", options),
    ),
    createSession: vi.fn(
      async (
        _path: string,
        _mode: unknown,
        _settings: unknown,
        options?: SessionLaunchOptions,
      ) => startNow("session-created", options),
    ),
  } as unknown as Supervisor;

  const routes = createSessionsRoutes({
    supervisor,
    scanner,
    readerFactory: vi.fn(() => {
      throw new Error("readerFactory should not be used");
    }),
    serverSettingsService,
    sessionMetadataService,
    workstreamService,
  });

  return {
    routes,
    supervisor,
    sessionMetadataService,
    workstreamService,
  };
}

describe("Session workstream routing", () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("starts a session in the checkout path while preserving canonical project id", async () => {
    const { routes, supervisor, sessionMetadataService } = createDeps();

    const response = await routes.request(`/projects/${projectId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "start here",
        workstreamId,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessionId: "session-started",
      projectId,
    });
    expect(supervisor.startSession).toHaveBeenCalledWith(
      checkoutPath,
      expect.objectContaining({ text: "start here" }),
      undefined,
      expect.any(Object),
      expect.objectContaining({ projectId, workstreamId }),
    );
    expect(sessionMetadataService.setWorkstream).toHaveBeenCalledWith(
      "session-started",
      workstreamId,
    );
  });

  it("creates a two-phase session in the checkout path", async () => {
    const { routes, supervisor, sessionMetadataService } = createDeps();

    const response = await routes.request(
      `/projects/${projectId}/sessions/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workstreamId }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessionId: "session-created",
      projectId,
    });
    expect(supervisor.createSession).toHaveBeenCalledWith(
      checkoutPath,
      undefined,
      expect.any(Object),
      expect.objectContaining({ projectId, workstreamId }),
    );
    expect(sessionMetadataService.setWorkstream).toHaveBeenCalledWith(
      "session-created",
      workstreamId,
    );
  });

  it("records normalized UI provenance on a started session", async () => {
    const { routes, sessionMetadataService } = createDeps();

    const response = await routes.request(`/projects/${projectId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "start here",
        creationProvenance: {
          surface: "web",
          clientOrigin: "https://example.test/ignored/path",
          clientVersion: "0.9.3-test",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(
      sessionMetadataService.recordCreationProvenance,
    ).toHaveBeenCalledWith("session-started", {
      surface: "web",
      clientOrigin: "https://example.test",
      clientVersion: "0.9.3-test",
    });
  });

  it("retains UI provenance when two-phase creation waits for a worker", async () => {
    const { routes, supervisor, sessionMetadataService } = createDeps();
    vi.mocked(supervisor.createSession).mockResolvedValueOnce({
      queued: true,
      queueId: "queue-1",
      position: 1,
    });

    const response = await routes.request(
      `/projects/${projectId}/sessions/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creationProvenance: {
            surface: "desktop",
            clientVersion: "0.9.3-test",
            clientCommit: "abc123",
          },
        }),
      },
    );

    expect(response.status).toBe(202);
    expect(
      sessionMetadataService.recordCreationProvenance,
    ).not.toHaveBeenCalled();
    const options = vi.mocked(supervisor.createSession).mock.calls[0]?.[3];
    await options?.onStarted?.(
      "session-created",
      createProcess("session-created"),
    );
    expect(
      sessionMetadataService.recordCreationProvenance,
    ).toHaveBeenCalledWith("session-created", {
      surface: "desktop",
      clientVersion: "0.9.3-test",
      clientCommit: "abc123",
    });
  });
});
