import { describe, expect, it } from "vitest";
import type {
  ProjectCollectionRecord,
  ProviderRuntimeStatusRecord,
  SessionCollectionRecord,
} from "../../lib/clientSummaryCollections";
import { createCockpitCatalog, filterCockpitCatalog } from "./catalog";

function project(
  id: string,
  name: string,
  path = `/work/${name}`,
): ProjectCollectionRecord {
  return {
    id,
    path,
    name,
    sessionCount: 0,
    activeOwnedCount: 0,
    activeExternalCount: 0,
    lastActivity: null,
    observedAt: 1,
  };
}

function session(
  id: string,
  projectId: string,
  fields: Partial<SessionCollectionRecord> = {},
): SessionCollectionRecord {
  return {
    id,
    projectId,
    observedAt: 1,
    ...fields,
  };
}

const noRuntimeErrors = new Map<string, ProviderRuntimeStatusRecord>();

describe("Cockpit catalog adapter", () => {
  it("keeps colliding project and session ids isolated by source", () => {
    const input = {
      projects: [project("project-1", "Atlas")],
      sessions: [session("session-1", "project-1", { title: "Plan" })],
      providerRuntimeBySessionId: noRuntimeErrors,
      connection: "online" as const,
    };

    const sourceA = createCockpitCatalog({ sourceKey: "host:a", ...input });
    const sourceB = createCockpitCatalog({ sourceKey: "host:b", ...input });

    expect(sourceA.projects[0]?.key).not.toBe(sourceB.projects[0]?.key);
    expect(sourceA.projects[0]?.sessions[0]?.key).not.toBe(
      sourceB.projects[0]?.sessions[0]?.key,
    );
  });

  it("pins favorites, then preserves the existing sidebar order", () => {
    const catalog = createCockpitCatalog({
      sourceKey: "local",
      projects: [project("project-1", "Atlas")],
      sessions: [
        session("provider-newer", "project-1", {
          title: "Background refresh",
          createdAt: "2026-09-20T08:00:00.000Z",
          lastHumanTurnAt: "2026-09-20T09:00:00.000Z",
          updatedAt: "2026-09-24T12:00:00.000Z",
        }),
        session("human-newer", "project-1", {
          title: "Release notes",
          createdAt: "2026-09-21T08:00:00.000Z",
          lastHumanTurnAt: "2026-09-23T09:00:00.000Z",
          updatedAt: "2026-09-23T09:00:00.000Z",
        }),
        session("favorite", "project-1", {
          title: "Pinned reference",
          createdAt: "2026-09-18T08:00:00.000Z",
          isStarred: true,
        }),
      ],
      providerRuntimeBySessionId: noRuntimeErrors,
      connection: "online",
      orderedSessionIds: ["favorite", "human-newer", "provider-newer"],
    });

    expect(catalog.projects[0]?.sessions.map((item) => item.id)).toEqual([
      "favorite",
      "human-newer",
      "provider-newer",
    ]);
  });

  it("projects honest active, input, error, complete, and offline states", () => {
    const runtimeErrors = new Map<string, ProviderRuntimeStatusRecord>([
      [
        "failed",
        {
          sessionId: "failed",
          status: {
            kind: "terminal",
            provider: "claude",
            reason: "server_error",
            message: "fixture failure",
            occurredAt: "2026-09-24T10:00:00.000Z",
            source: "fixture",
          },
          observedAt: 1,
        },
      ],
    ]);
    const sessions = [
      session("active", "project-1", { activity: "in-turn" }),
      session("approval", "project-1", {
        activity: "waiting-input",
        pendingInputType: "tool-approval",
      }),
      session("question", "project-1", {
        activity: "waiting-input",
        pendingInputType: "user-question",
      }),
      session("failed", "project-1"),
      session("done", "project-1", { activity: "idle" }),
      session("terminal", "project-1", { ownership: { owner: "external" } }),
    ];
    const online = createCockpitCatalog({
      sourceKey: "local",
      projects: [project("project-1", "Atlas")],
      sessions,
      providerRuntimeBySessionId: runtimeErrors,
      connection: "online",
    });

    expect(
      Object.fromEntries(
        online.projects[0]?.sessions.map(
          (item) => [item.id, item.status] as const,
        ) ?? [],
      ),
    ).toEqual({
      active: "active",
      approval: "approval",
      question: "question",
      failed: "error",
      done: "complete",
      terminal: "external",
    });

    const offline = createCockpitCatalog({
      sourceKey: "local",
      projects: [project("project-1", "Atlas")],
      sessions,
      providerRuntimeBySessionId: runtimeErrors,
      connection: "offline",
    });
    expect(
      offline.projects[0]?.sessions.every((item) => item.status === "offline"),
    ).toBe(true);
  });

  it("keeps an automatically retrying provider session active", () => {
    const runtimeStatuses = new Map<string, ProviderRuntimeStatusRecord>([
      [
        "retrying",
        {
          sessionId: "retrying",
          status: {
            kind: "retrying",
            provider: "claude",
            reason: "overloaded",
            startedAt: "2026-09-25T03:00:00.000Z",
            lastSeenAt: "2026-09-25T03:00:01.000Z",
            eventCount: 1,
            source: "fixture",
          },
          observedAt: 1,
        },
      ],
    ]);

    const catalog = createCockpitCatalog({
      sourceKey: "local",
      projects: [project("project-1", "Atlas")],
      sessions: [session("retrying", "project-1", { activity: "idle" })],
      providerRuntimeBySessionId: runtimeStatuses,
      connection: "online",
    });

    expect(catalog.projects[0]?.sessions[0]?.status).toBe("active");
  });

  it("filters only the already loaded project and session summaries", () => {
    const catalog = createCockpitCatalog({
      sourceKey: "local",
      projects: [project("atlas", "Atlas"), project("beacon", "Beacon")],
      sessions: [
        session("one", "atlas", { title: "Release checklist" }),
        session("two", "beacon", { title: "Mobile layout", model: "opus" }),
      ],
      providerRuntimeBySessionId: noRuntimeErrors,
      connection: "online",
    });

    expect(filterCockpitCatalog(catalog, "release").sessionCount).toBe(1);
    expect(filterCockpitCatalog(catalog, "beacon").projects[0]?.name).toBe(
      "Beacon",
    );
    expect(filterCockpitCatalog(catalog, "opus").projects[0]?.sessions[0]?.id).toBe(
      "two",
    );
  });

  it("filters a saved view to pinned sessions without losing project grouping", () => {
    const catalog = createCockpitCatalog({
      sourceKey: "host:alpha",
      projects: [project("project-1", "Atlas")],
      sessions: [
        session("favorite", "project-1", { isStarred: true }),
        session("ordinary", "project-1"),
      ],
      providerRuntimeBySessionId: noRuntimeErrors,
      connection: "online",
    });

    expect(
      filterCockpitCatalog(catalog, "", { pinnedOnly: true }).projects[0]
        ?.sessions.map((entry) => entry.id),
    ).toEqual(["favorite"]);
  });
});
