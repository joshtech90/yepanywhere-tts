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
}) {
  const scanner = {
    getProject: vi.fn(async () => options.staleProject),
    getOrCreateProject: vi.fn(async () => options.freshProject),
  };
  const routes = createSessionsRoutes({
    supervisor: {
      getProcessForSession: () => undefined,
      wasEverOwned: () => false,
    } as unknown as SessionsDeps["supervisor"],
    scanner: scanner as unknown as SessionsDeps["scanner"],
    readerFactory: (project: Project) =>
      ({
        getSession: async () =>
          project.sessionDir === options.sessionDirWithTranscript
            ? loadedSession()
            : null,
      }) as unknown as ISessionReader,
  });
  return { routes, scanner };
}

describe("session detail project lookup", () => {
  it("reuses the resolved project instead of rescanning every provider", async () => {
    const { routes, scanner } = createRoutes({
      staleProject: createProject("/sessions/a"),
      freshProject: createProject("/sessions/a"),
      sessionDirWithTranscript: "/sessions/a",
    });

    const response = await routes.request("/projects/proj-1/sessions/sess-1");

    expect(response.status).toBe(200);
    expect(scanner.getProject).toHaveBeenCalledWith("proj-1", {
      allowStaleSnapshot: true,
    });
    expect(scanner.getOrCreateProject).not.toHaveBeenCalled();
  });

  it("rescans once when the reused project does not hold the transcript", async () => {
    const { routes, scanner } = createRoutes({
      staleProject: createProject("/sessions/old"),
      freshProject: createProject("/sessions/merged"),
      sessionDirWithTranscript: "/sessions/merged",
    });

    const response = await routes.request("/projects/proj-1/sessions/sess-1");

    expect(response.status).toBe(200);
    expect((await response.json()).session).toMatchObject({ id: "sess-1" });
    expect(scanner.getOrCreateProject).toHaveBeenCalledTimes(1);
  });

  it("falls back to a fresh lookup for a project the snapshot lacks", async () => {
    const { routes, scanner } = createRoutes({
      staleProject: null,
      freshProject: createProject("/sessions/new"),
      sessionDirWithTranscript: "/sessions/new",
    });

    const response = await routes.request("/projects/proj-1/sessions/sess-1");

    expect(response.status).toBe(200);
    expect(scanner.getOrCreateProject).toHaveBeenCalledTimes(1);
  });
});
