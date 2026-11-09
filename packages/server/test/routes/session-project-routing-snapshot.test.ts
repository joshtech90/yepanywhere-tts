import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionMetadataService } from "../../src/metadata/SessionMetadataService.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createSessionProjectRouting } from "../../src/routes/session-project-routing.js";
import type { SessionIdentity } from "../../src/sessions/SessionIdentityStore.js";
import type { Project } from "../../src/supervisor/types.js";

// Fork: a session an agent is writing invalidates the project snapshot on
// every append. Detail reads may reuse the snapshot, including for sessions
// with a stored YA identity whose transcript lives in another project; only a
// project the snapshot does not know falls back to a fresh scan.

const workingId = "d29ya2luZw" as UrlProjectId;
const transcriptId = "dHJhbnNjcmlwdA" as UrlProjectId;

function project(id: UrlProjectId): Project {
  return {
    id,
    path: `/fixture/${id}`,
    name: id,
    provider: "codex",
    sessionDir: `/fixture/${id}/sessions`,
    sessionCount: 1,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
  };
}

const identity = {
  sessionId: "ya_snapshot_fixture",
  provider: "codex",
  projectId: transcriptId,
  createdAt: "2026-11-09T00:00:00.000Z",
  native: null,
} as unknown as SessionIdentity;

function routingWith(snapshot: Map<string, Project>) {
  const getProject = vi.fn(
    async (id: string, options?: { allowStaleSnapshot?: boolean }) =>
      options?.allowStaleSnapshot ? (snapshot.get(id) ?? null) : null,
  );
  const getOrCreateProject = vi.fn(async (id: string) =>
    project(id as UrlProjectId),
  );
  const listProjects = vi.fn(async () => [] as Project[]);
  const scanner = {
    getProject,
    getOrCreateProject,
    listProjects,
  } as unknown as Pick<ProjectScanner, "getOrCreateProject"> &
    Partial<Pick<ProjectScanner, "getProject" | "listProjects">>;
  const routing = createSessionProjectRouting(
    {
      supervisor: { getProcessForSession: () => undefined },
      scanner,
      // The session was moved to another working project; its transcript
      // stays in the identity's project.
      sessionMetadataService: {
        getMetadata: () => ({ workingProjectId: workingId }),
      } as unknown as SessionMetadataService,
      readerFactory: () => {
        throw new Error("Unexpected reader");
      },
    },
    (sessionId) => (sessionId === identity.sessionId ? identity : undefined),
  );
  return { routing, getOrCreateProject, listProjects };
}

describe("session project routing with a reused snapshot", () => {
  it("resolves a stored identity's projects without a fresh scan", async () => {
    const { routing, getOrCreateProject, listProjects } = routingWith(
      new Map([
        [workingId, project(workingId)],
        [transcriptId, project(transcriptId)],
      ]),
    );
    const result = await routing.resolveSessionProjectRouting(
      workingId,
      identity.sessionId,
      { allowStaleSnapshot: true },
    );
    expect(result).toMatchObject({
      workingProjectId: workingId,
      transcriptProjectId: transcriptId,
      identityLookup: { kind: "stored" },
    });
    expect(getOrCreateProject).not.toHaveBeenCalled();
    // The reuse schedules one background refresh of the project list.
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it("scans fresh for a project the snapshot does not know", async () => {
    const { routing, getOrCreateProject } = routingWith(
      new Map([[workingId, project(workingId)]]),
    );
    await routing.resolveSessionProjectRouting(workingId, identity.sessionId, {
      allowStaleSnapshot: true,
    });
    expect(getOrCreateProject.mock.calls.map(([id]) => id)).toEqual([
      transcriptId,
    ]);
  });

  it("always scans fresh without the reuse option", async () => {
    const { routing, getOrCreateProject } = routingWith(
      new Map([
        [workingId, project(workingId)],
        [transcriptId, project(transcriptId)],
      ]),
    );
    await routing.resolveSessionProjectRouting(workingId, identity.sessionId);
    expect(getOrCreateProject.mock.calls.map(([id]) => id)).toEqual([
      workingId,
      transcriptId,
    ]);
  });
});
