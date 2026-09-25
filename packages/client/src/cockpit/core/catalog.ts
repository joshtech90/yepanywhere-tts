import { projectDisplayName } from "@yep-anywhere/shared";
import type {
  ProjectCollectionRecord,
  ProviderRuntimeStatusRecord,
  SessionCollectionRecord,
} from "../../lib/clientSummaryCollections";

export type CockpitSessionStatus =
  | "active"
  | "external"
  | "complete"
  | "approval"
  | "question"
  | "error"
  | "offline";

export interface CockpitCatalogSession {
  key: string;
  id: string;
  projectId: string | null;
  title: string;
  provider?: string;
  model?: string;
  lastActivityAt?: string;
  pinned: boolean;
  status: CockpitSessionStatus;
}

export interface CockpitCatalogProject {
  key: string;
  id: string | null;
  name: string;
  path: string;
  lastActivityAt?: string;
  sessions: CockpitCatalogSession[];
}

export interface CockpitCatalogView {
  sourceKey: string;
  projects: CockpitCatalogProject[];
  sessionCount: number;
}

export interface CreateCockpitCatalogInput {
  sourceKey: string;
  projects: readonly ProjectCollectionRecord[];
  sessions: readonly SessionCollectionRecord[];
  providerRuntimeBySessionId: ReadonlyMap<
    string,
    ProviderRuntimeStatusRecord
  >;
  connection: "online" | "offline" | "error";
  orderedSessionIds?: readonly string[];
}

function timestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function sessionActivityAt(
  session: SessionCollectionRecord,
): string | undefined {
  return [session.lastHumanTurnAt, session.createdAt, session.updatedAt].reduce<
    string | undefined
  >(
    (latest, candidate) =>
      timestamp(candidate) > timestamp(latest) ? candidate : latest,
    undefined,
  );
}

function sessionTitle(session: SessionCollectionRecord): string {
  return (
    session.customTitle?.trim() ||
    session.title?.trim() ||
    session.initialPrompt?.trim() ||
    ""
  );
}

function deriveSessionStatus(
  session: SessionCollectionRecord,
  providerRuntime: ProviderRuntimeStatusRecord | undefined,
  connection: CreateCockpitCatalogInput["connection"],
): CockpitSessionStatus {
  if (connection === "offline") return "offline";
  if (
    connection === "error" ||
    providerRuntime?.status.kind === "terminal"
  ) {
    return "error";
  }
  if (session.pendingInputType === "tool-approval") return "approval";
  if (
    session.pendingInputType === "user-question" ||
    session.activity === "waiting-input" ||
    Boolean(session.asyncQuestions?.questions.length)
  ) {
    return "question";
  }
  if (
    providerRuntime?.status.kind === "retrying" ||
    session.activity === "in-turn"
  ) {
    return "active";
  }
  // Another program wrote the transcript within the server's decay window.
  if (session.ownership?.owner === "external") return "external";
  return "complete";
}

function compareSessions(
  left: CockpitCatalogSession,
  right: CockpitCatalogSession,
  orderBySessionId: ReadonlyMap<string, number>,
): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const leftRank = orderBySessionId.get(left.id);
  const rightRank = orderBySessionId.get(right.id);
  if (leftRank !== undefined || rightRank !== undefined) {
    const rank =
      (leftRank ?? Number.POSITIVE_INFINITY) -
      (rightRank ?? Number.POSITIVE_INFINITY);
    if (rank !== 0) return rank;
  }
  const activity =
    timestamp(right.lastActivityAt) - timestamp(left.lastActivityAt);
  if (activity !== 0) return activity;
  const title = left.title.localeCompare(right.title);
  return title !== 0 ? title : left.key.localeCompare(right.key);
}

function compareProjects(
  left: CockpitCatalogProject,
  right: CockpitCatalogProject,
  orderBySessionId: ReadonlyMap<string, number>,
): number {
  const projectRank = (project: CockpitCatalogProject) =>
    project.sessions.reduce(
      (rank, session) =>
        Math.min(
          rank,
          orderBySessionId.get(session.id) ?? Number.POSITIVE_INFINITY,
        ),
      Number.POSITIVE_INFINITY,
    );
  const leftRank = projectRank(left);
  const rightRank = projectRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  const activity =
    timestamp(right.lastActivityAt) - timestamp(left.lastActivityAt);
  if (activity !== 0) return activity;
  const name = left.name.localeCompare(right.name);
  return name !== 0 ? name : left.key.localeCompare(right.key);
}

function projectKey(sourceKey: string, projectId: string | null): string {
  return `${sourceKey}\0project\0${projectId ?? "unassigned"}`;
}

function sessionKey(sourceKey: string, sessionId: string): string {
  return `${sourceKey}\0session\0${sessionId}`;
}

export function createCockpitCatalog({
  sourceKey,
  projects,
  sessions,
  providerRuntimeBySessionId,
  connection,
  orderedSessionIds = [],
}: CreateCockpitCatalogInput): CockpitCatalogView {
  const groups = new Map<string | null, CockpitCatalogProject>();
  const orderBySessionId = new Map(
    orderedSessionIds.map((sessionId, index) => [sessionId, index] as const),
  );

  for (const project of projects) {
    groups.set(project.id, {
      key: projectKey(sourceKey, project.id),
      id: project.id,
      name: projectDisplayName(project),
      path: project.path,
      sessions: [],
    });
  }

  for (const session of sessions) {
    const projectId = session.projectId ?? null;
    let group = groups.get(projectId);
    if (!group) {
      group = {
        key: projectKey(sourceKey, projectId),
        id: projectId,
        name: session.projectName?.trim() ?? "",
        path: "",
        sessions: [],
      };
      groups.set(projectId, group);
    }

    const lastActivityAt = sessionActivityAt(session);
    group.sessions.push({
      key: sessionKey(sourceKey, session.id),
      id: session.id,
      projectId,
      title: sessionTitle(session),
      provider: session.provider,
      model: session.model,
      lastActivityAt,
      pinned: session.isStarred === true,
      status: deriveSessionStatus(
        session,
        providerRuntimeBySessionId.get(session.id),
        connection,
      ),
    });
  }

  const orderedProjects = [...groups.values()].map((project) => {
    project.sessions.sort((left, right) =>
      compareSessions(left, right, orderBySessionId),
    );
    return {
      ...project,
      lastActivityAt: project.sessions.reduce<string | undefined>(
        (latest, session) =>
          timestamp(session.lastActivityAt) > timestamp(latest)
            ? session.lastActivityAt
            : latest,
        undefined,
      ),
    };
  });
  orderedProjects.sort((left, right) =>
    compareProjects(left, right, orderBySessionId),
  );

  return {
    sourceKey,
    projects: orderedProjects,
    sessionCount: sessions.length,
  };
}

function normalized(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function sessionMatches(
  session: CockpitCatalogSession,
  needle: string,
): boolean {
  return [session.title, session.provider, session.model].some((value) =>
    normalized(value).includes(needle),
  );
}

export function filterCockpitCatalog(
  catalog: CockpitCatalogView,
  query: string,
  options: { pinnedOnly?: boolean } = {},
): CockpitCatalogView {
  const needle = normalized(query);
  if (!needle && !options.pinnedOnly) return catalog;

  const projects = catalog.projects.flatMap((project) => {
    const projectMatches = [project.name, project.path].some((value) =>
      normalized(value).includes(needle),
    );
    const sessions = project.sessions.filter(
      (session) =>
        (!options.pinnedOnly || session.pinned) &&
        (!needle || projectMatches || sessionMatches(session, needle)),
    );
    return sessions.length > 0 || (projectMatches && !options.pinnedOnly)
      ? [{ ...project, sessions }]
      : [];
  });

  return {
    ...catalog,
    projects,
    sessionCount: projects.reduce(
      (count, project) => count + project.sessions.length,
      0,
    ),
  };
}
