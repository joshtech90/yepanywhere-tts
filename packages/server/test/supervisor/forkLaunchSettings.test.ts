import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  EffectiveSessionLaunchSettings,
  ProviderName,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import { getLogger } from "../../src/logging/logger.js";
import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type { AgentProvider } from "../../src/sdk/providers/types.js";
import {
  ForkSettingsPersistenceError,
  Supervisor,
} from "../../src/supervisor/Supervisor.js";
import {
  createSessionsRoutes,
  type SessionsDeps,
} from "../../src/routes/sessions.js";
import { encodeProjectId } from "../../src/projects/paths.js";

const source: EffectiveSessionLaunchSettings = {
  schemaVersion: 1,
  revision: 7,
  permissionMode: "bypassPermissions",
  requestedModel: "source-model",
  serviceTier: "priority",
  thinking: { type: "adaptive", display: "summarized" },
  effort: "high",
};

describe("fork launch settings", () => {
  let dataDir: string;
  let metadata: SessionMetadataService;
  const owners: Supervisor[] = [];

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "fork-settings-"));
    metadata = new SessionMetadataService({ dataDir });
    await metadata.initialize();
    await metadata.recordEffectiveLaunchSettings("source", source);
  });
  afterEach(async () => {
    for (const owner of owners.splice(0)) await dispose(owner);
    vi.restoreAllMocks();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function dispose(supervisor: Supervisor) {
    await Promise.all(
      supervisor
        .getAllProcesses()
        .map((process) => supervisor.abortProcess(process.id)),
    );
    await supervisor.stopBackgroundTasks();
  }

  function owner(providerName: ProviderName, service = metadata) {
    const startSession = vi.fn<AgentProvider["startSession"]>(
      async (options) => {
        const queue = new MessageQueue();
        const messages = queue.generator();
        async function* iterator() {
          yield {
            type: "system" as const,
            subtype: "init" as const,
            session_id: options.resumeSessionId,
          };
          for await (const message of messages) {
            void message;
            yield {
              type: "result" as const,
              subtype: "success" as const,
              session_id: options.resumeSessionId,
            };
          }
        }
        return {
          iterator: iterator(),
          queue,
          abort: async () => {
            await messages.return();
          },
        };
      },
    );
    const forkSession = vi.fn(async () => ({ sessionId: "child" }));
    const supervisor = new Supervisor({
      provider: {
        name: providerName,
        forkSession,
        startSession,
      } as unknown as AgentProvider,
      sessionMetadataService: service,
      defaultPermissionMode: "default",
    });
    owners.push(supervisor);
    return { supervisor, startSession, forkSession };
  }

  for (const providerName of ["claude", "codex", "pi"] as const) {
    for (const [permissionMode, thinking, effort] of [
      ["bypassPermissions", source.thinking, "high"],
      ["plan", { type: "disabled" }, null],
      ["default", null, null],
    ] as const) {
      it(`${providerName}: retains ${permissionMode} through first send and a fresh server owner`, async () => {
        const expected = { ...source, permissionMode, thinking, effort };
        await metadata.recordEffectiveLaunchSettings("source", expected);
        const original = metadata.getMetadata("source");
        const { supervisor, forkSession } = owner(providerName);
        const fork = await supervisor.forkSession({
          sessionId: "source",
          projectPath: dataDir,
          providerName,
          // Prefix selection must not choose historical configuration.
          upToMessageId: "older-turn",
        });
        expect(forkSession).toHaveBeenCalledWith(
          expect.objectContaining({
            upToMessageId: "older-turn",
            launchSettings: {
              permissionMode,
              requestedModel: "source-model",
              serviceTier: "priority",
              thinking,
              effort,
            },
          }),
        );
        expect(metadata.getEffectiveLaunchSettings("child")).toEqual({
          ...expected,
          schemaVersion: 1,
          revision: 1,
        });
        expect(metadata.getMetadata("source")).toEqual(original);

        for (let turn = 0; turn < 2; turn++) {
          const restored = new SessionMetadataService({ dataDir });
          await restored.initialize();
          const resumed = owner(providerName, restored);
          const process = await resumed.supervisor.resumeSession(
            fork.sessionId,
            dataDir,
            { text: `Child turn ${turn}` },
            undefined,
            { providerName },
          );
          expect(resumed.startSession).toHaveBeenCalledWith(
            expect.objectContaining({
              resumeSessionId: "child",
              permissionMode,
              model: "source-model",
              serviceTier: "priority",
              thinking: thinking ?? undefined,
              effort: effort ?? undefined,
            }),
          );
          expect(process).toHaveProperty("sessionId", "child");
          await dispose(resumed.supervisor);
        }
      });
    }
  }

  it("replaces only explicit thinking and keeps a frozen source for summary targets", async () => {
    const { supervisor } = owner("claude");
    const generator = await supervisor.forkSession({
      sessionId: "source",
      projectPath: dataDir,
      launchOverrides: { thinking: "on:low" },
    });
    expect(generator.launchSettings).toEqual({
      permissionMode: "bypassPermissions",
      requestedModel: "source-model",
      serviceTier: "priority",
      thinking: source.thinking,
      effort: "low",
    });
    const frozen = await supervisor.resolveForkLaunchSettings(
      "source",
      dataDir,
      "claude",
    );
    await metadata.recordEffectiveLaunchSettings("source", {
      ...source,
      permissionMode: "default",
      effort: "max",
    });
    const target = await supervisor.forkSession({
      sessionId: "source",
      projectPath: dataDir,
      launchSettings: frozen,
      launchOverrides: { permissionMode: "plan" },
    });
    expect(target.launchSettings).toEqual({
      ...frozen,
      permissionMode: "plan",
    });
    expect(target.launchSettings.effort).toBe("high");
  });

  it("recovers a legacy source without activating or migrating it", async () => {
    const provider = {
      name: "codex",
      forkSession: vi.fn(async () => ({ sessionId: "child" })),
    } as unknown as AgentProvider;
    const recover = vi.fn(async () => ({
      permissionMode: "bypassPermissions" as const,
      requestedModel: "recovered-model",
      thinking: source.thinking!,
      effort: "high" as const,
    }));
    const supervisor = new Supervisor({
      provider,
      sessionMetadataService: metadata,
      recoverSessionLaunchSettings: recover,
    });
    owners.push(supervisor);
    const fork = await supervisor.forkSession({
      sessionId: "legacy",
      projectPath: dataDir,
    });
    expect(fork.launchSettings).toMatchObject({
      permissionMode: "bypassPermissions",
      requestedModel: "recovered-model",
      effort: "high",
    });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(metadata.getMetadata("legacy")).toBeUndefined();
    expect(supervisor.getProcessForSession("legacy")).toBeUndefined();
  });

  it("copies the same snapshot for a legacy Claude aside clone", async () => {
    const sessionsDir = join(dataDir, "sessions");
    await mkdir(sessionsDir);
    await writeFile(
      join(sessionsDir, "source.jsonl"),
      `${JSON.stringify({
        type: "user",
        uuid: "prompt",
        sessionId: "source",
        parentUuid: null,
        message: { role: "user", content: "Retained prompt" },
      })}\n`,
    );
    const { supervisor } = owner("claude");
    const projectId = encodeProjectId(dataDir);
    const routes = createSessionsRoutes({
      supervisor,
      sessionMetadataService: metadata,
      scanner: {
        getOrCreateProject: async () => ({
          id: projectId,
          path: dataDir,
          provider: "claude",
          sessionDir: sessionsDir,
        }),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: () =>
        ({
          getSessionSummary: async () => ({
            id: "source",
            title: "Source",
            provider: "claude",
            messageCount: 1,
          }),
        }) as unknown as ReturnType<SessionsDeps["readerFactory"]>,
    });
    const response = await routes.request(
      `/projects/${projectId}/sessions/source/clone`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentSessionId: "source" }),
      },
    );
    expect(response.status).toBe(200);
    const child = (await response.json()) as { sessionId: string };
    expect(metadata.getEffectiveLaunchSettings(child.sessionId)).toEqual({
      ...source,
      revision: 1,
    });
    expect(metadata.getMetadata(child.sessionId)?.parentSessionKind).toBe(
      "btw-aside",
    );
  });

  it("returns an honest creation failure if the child snapshot cannot be saved", async () => {
    await metadata.setTitle("source", "Source");
    vi.spyOn(getLogger(), "error").mockImplementation(() => undefined);
    const record = metadata.recordEffectiveLaunchSettings.bind(metadata);
    vi.spyOn(metadata, "recordEffectiveLaunchSettings").mockImplementation(
      (id, value) => {
        if (id === "child") throw new Error("disk unavailable");
        return record(id, value);
      },
    );
    const { supervisor, forkSession } = owner("claude");
    const projectId = encodeProjectId(dataDir);
    const routes = createSessionsRoutes({
      supervisor,
      sessionMetadataService: metadata,
      scanner: {
        getOrCreateProject: async () => ({
          id: projectId,
          path: dataDir,
          provider: "claude",
        }),
      } as unknown as SessionsDeps["scanner"],
      readerFactory: () =>
        ({
          getSessionListSummary: async () => null,
          getSessionSummary: async () => null,
        }) as unknown as ReturnType<SessionsDeps["readerFactory"]>,
    });
    vi.spyOn(getLogger(), "warn").mockImplementation(() => undefined);
    const response = await routes.request(
      `/projects/${projectId}/sessions/source/fork`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forkKind: "clone-latest-complete" }),
      },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("child was created"),
    });
    expect(forkSession).toHaveBeenCalledTimes(1);
    expect(metadata.getMetadata("source")?.forksCreated).toBe(1);
    expect(metadata.getEffectiveLaunchSettings("source")).toMatchObject(source);
    await expect(
      supervisor.recordForkLaunchSettings("child", source),
    ).rejects.toBeInstanceOf(ForkSettingsPersistenceError);
  });
});
