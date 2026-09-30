import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import {
  createSessionsRoutes,
  type SessionsDeps,
} from "../../src/routes/sessions.js";
import type { ISessionReader } from "../../src/sessions/types.js";
import type { Project } from "../../src/supervisor/types.js";

function createProject(sessionDir: string): Project {
  return {
    id: "proj-1" as UrlProjectId,
    path: "/tmp/project",
    name: "project",
    sessionCount: 1,
    sessionDir,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
    provider: "claude",
  };
}

function loadedSession() {
  const summary = {
    id: "sess-1",
    projectId: "proj-1" as UrlProjectId,
    title: "Title",
    fullTitle: "Title",
    createdAt: "2026-09-30T08:00:00.000Z",
    updatedAt: "2026-09-30T08:01:00.000Z",
    messageCount: 0,
    ownership: { owner: "none" as const },
    provider: "claude" as const,
  };
  return {
    summary,
    data: { provider: "claude", session: { messages: [] } },
  };
}

function createRoutes(options: {
  staleProject: Project | null;
  freshProject: Project;
  sessionDirWithTranscript: string;
  workingProjectIdAfterMiss?: string;
}) {
  let missed = false;
  const scanner = {
    getProject: vi.fn(async () => options.staleProject),
    getOrCreateProject: vi.fn(async () => options.freshProject),
    listProjects: vi.fn(async () => []),
  };
  const routes = createSessionsRoutes({
    supervisor: {
      getProcessForSession: () => undefined,
      wasEverOwned: () => false,
    } as unknown as SessionsDeps["supervisor"],
    scanner: scanner as unknown as SessionsDeps["scanner"],
    readerFactory: (project: Project) =>
      ({
        getSession: async () => {
          if (project.sessionDir === options.sessionDirWithTranscript) {
            return loadedSession();
          }
          missed = true;
          return null;
        },
      }) as unknown as ISessionReader,
    // The session moved to another project while the stale read ran.
    sessionMetadataService: {
      getMetadata: () =>
        missed && options.workingProjectIdAfterMiss
          ? { workingProjectId: options.workingProjectIdAfterMiss }
          : undefined,
      getProvider: () => undefined,
      getRecapMessages: () => [],
    } as unknown as SessionsDeps["sessionMetadataService"],
  });
  return { routes, scanner };
}

describe("session detail project lookup", () => {
  it("serves an open session without rescanning every provider's projects", async () => {
    const { routes, scanner } = createRoutes({
      staleProject: createProject("/sessions/a"),
      freshProject: createProject("/sessions/a"),
      sessionDirWithTranscript: "/sessions/a",
    });

    const response = await routes.request("/projects/proj-1/sessions/sess-1");

    expect(response.status).toBe(200);
    expect(scanner.getOrCreateProject).not.toHaveBeenCalled();
  });

  it.each([
    ["the reused project lacks the transcript", createProject("/sessions/old")],
    ["the snapshot does not know the project yet", null],
  ])("still finds the session when %s", async (_case, staleProject) => {
    const { routes } = createRoutes({
      staleProject,
      freshProject: createProject("/sessions/new"),
      sessionDirWithTranscript: "/sessions/new",
    });

    const response = await routes.request("/projects/proj-1/sessions/sess-1");

    expect(response.status).toBe(200);
    expect((await response.json()).session).toMatchObject({ id: "sess-1" });
  });

  it("redirects instead of 404 when the session moved during the lookup", async () => {
    const { routes } = createRoutes({
      staleProject: createProject("/sessions/old"),
      freshProject: createProject("/sessions/new"),
      sessionDirWithTranscript: "/sessions/none",
      workingProjectIdAfterMiss: "proj-2",
    });

    const response = await routes.request("/projects/proj-1/sessions/sess-1");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/api/projects/proj-2/sessions/sess-1",
    );
  });
});
