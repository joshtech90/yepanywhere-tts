import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import { encodeProjectId } from "../../src/projects/paths.js";
import {
  createSessionsRoutes,
  type SessionsDeps,
} from "../../src/routes/sessions.js";
import { MockClaudeSDK, createMockScenario } from "../../src/sdk/mock.js";
import type { Process } from "../../src/supervisor/Process.js";
import {
  type SessionLaunchOptions,
  Supervisor,
} from "../../src/supervisor/Supervisor.js";
import type { Project } from "../../src/supervisor/types.js";

/**
 * A session start that waits for a free worker records the same launch
 * metadata and creator as one that starts at once: the routes write both from
 * the launch's `onStarted`, which a queued start runs only when it starts.
 */
describe("a session start that waits for a worker", () => {
  let root: string;
  let projectPath: string;
  let projectId: UrlProjectId;
  let project: Project;
  let metadata: SessionMetadataService;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    root = join(tmpdir(), `queued-start-metadata-${randomUUID()}`);
    projectPath = join(root, "project");
    await mkdir(projectPath, { recursive: true });
    projectId = encodeProjectId(projectPath);
    project = {
      id: projectId,
      path: projectPath,
      name: "project",
      sessionCount: 0,
      sessionDir: join(root, "sessions"),
      activeOwnedCount: 0,
      activeExternalCount: 0,
      lastActivity: null,
      provider: "claude",
    };
    metadata = new SessionMetadataService({ dataDir: join(root, "data") });
    await metadata.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  function routesFor(supervisor: SessionsDeps["supervisor"]) {
    return createSessionsRoutes({
      supervisor,
      scanner: {
        getOrCreateProject: async () => project,
      } as unknown as SessionsDeps["scanner"],
      readerFactory: () => {
        throw new Error("readerFactory should not be used");
      },
      sessionMetadataService: metadata,
    });
  }

  it("records its launch metadata once the worker queue starts it", async () => {
    const sdk = new MockClaudeSDK();
    sdk.addScenario(createMockScenario("first-session", "first"));
    sdk.addScenario(createMockScenario("queued-session", "second"));
    const supervisor = new Supervisor({
      sdk,
      maxWorkers: 1,
      idlePreemptThresholdMs: 60_000,
      // Moves what a launch recorded under its provisional id to its own.
      sessionMetadataService: metadata,
    });
    const routes = routesFor(supervisor);
    const start = (message: string) =>
      routes.request(`/projects/${projectId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, model: "opus", mode: "default" }),
      });

    const first = await start("occupy the worker");
    expect(first.status).toBe(200);
    const { processId, sessionId: firstSessionId } = (await first.json()) as {
      processId: string;
      sessionId: string;
    };

    const queued = await start("wait for a worker");
    expect(queued.status).toBe(202);
    const recorded = () => Object.keys(metadata.getAllMetadata());
    expect(recorded()).toEqual([firstSessionId]);
    await supervisor.abortProcess(processId);

    await vi.waitFor(() => {
      const queuedSessionId = supervisor
        .getAllProcesses()
        .find((process) => process.sessionId !== firstSessionId)?.sessionId;
      expect(queuedSessionId).toBeDefined();
      expect(metadata.getMetadata(queuedSessionId as string)).toMatchObject({
        initialPrompt: "wait for a worker",
        requestedModel: "opus",
        sandboxLevel: "none",
        workingProjectId: projectId,
      });
    });
    for (const process of supervisor.getAllProcesses()) await process.abort();
  });

  describe("for a limited user", () => {
    const limited: Principal = {
      kind: "limited",
      username: "alice",
      grants: {
        newSessionProjects: [],
        joinProjects: [],
        viewProjects: [],
        joinStaleOffsetMinutes: 0,
        lock: {},
      },
      switched: false,
      locked: true,
      via: "direct",
    };

    /** A supervisor whose pool is full: every launch waits for a worker. */
    function queueingSupervisor() {
      const waiting: SessionLaunchOptions[] = [];
      const queue = (options?: SessionLaunchOptions) => {
        waiting.push(options ?? {});
        return {
          queued: true,
          queueId: `queue-${waiting.length}`,
          position: 1,
        };
      };
      const supervisor = {
        startSession: vi.fn(
          async (
            _path: string,
            _message: unknown,
            _mode: unknown,
            _settings: unknown,
            options?: SessionLaunchOptions,
          ) => queue(options),
        ),
        createSession: vi.fn(
          async (
            _path: string,
            _mode: unknown,
            _settings: unknown,
            options?: SessionLaunchOptions,
          ) => queue(options),
        ),
      } as unknown as SessionsDeps["supervisor"];
      return { supervisor, waiting };
    }

    /** The sandboxed process a freed worker starts. */
    const sandboxedProcess = (sessionId: string) =>
      ({
        id: `process-${sessionId}`,
        sessionId,
        projectId,
        projectPath,
        sandboxStateKey: "project-state",
        sandboxProjectPath: projectPath,
        promptSuggestionMode: "native",
      }) as unknown as Process;

    function appFor(supervisor: SessionsDeps["supervisor"]) {
      limited.grants.newSessionProjects = [projectId];
      const app = new Hono<{
        Variables: Record<typeof PRINCIPAL_VARIABLE, Principal>;
      }>();
      app.use("*", async (c, next) => {
        c.set(PRINCIPAL_VARIABLE, limited);
        await next();
      });
      app.route("/", routesFor(supervisor));
      return app;
    }

    for (const [route, body] of [
      ["sessions", { message: "build it", model: "opus" }],
      ["sessions/create", { model: "opus" }],
    ] as const) {
      it(`records the creator and sandbox of a queued ${route} start`, async () => {
        const { supervisor, waiting } = queueingSupervisor();
        const response = await appFor(supervisor).request(
          `/projects/${projectId}/${route}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        expect(response.status).toBe(202);
        // Nothing is recorded for a session that has not started.
        expect(metadata.getAllMetadata()).toEqual({});

        await waiting[0]?.onStarted?.(
          "queued-session",
          sandboxedProcess("queued-session"),
        );
        expect(metadata.getMetadata("queued-session")).toMatchObject({
          createdByUser: "alice",
          requestedModel: "opus",
          promptSuggestionMode: "native",
          sandboxLevel: "project-write",
          sandboxNetworkFirewall: true,
          sandboxStateKey: "project-state",
          sandboxProjectPath: projectPath,
          workingProjectId: projectId,
        });
      });
    }
  });
});
