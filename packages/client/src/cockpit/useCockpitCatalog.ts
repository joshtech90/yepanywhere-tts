import { useEffect, useMemo, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useGlobalSessionsFeed } from "../hooks/useGlobalSessionsFeed";
import { useProjects } from "../hooks/useProjects";
import { useSidebarSessionOrder } from "../hooks/useSidebarSessionOrder";
import {
  useClientSummaryState,
  useSessionCollectionQueryRecords,
} from "../lib/clientSummaryStore";
import type { CockpitShellState } from "./core/shellState";
import { createCockpitCatalog, type CockpitCatalogView } from "./core/catalog";
import {
  useCockpitOrganization,
  type CockpitOrganizationController,
} from "./useCockpitOrganization";

export interface CockpitCatalogData {
  catalog: CockpitCatalogView;
  error: Error | null;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  organization: CockpitOrganizationController;
}

/** The server's page maximum; nobody pins more sessions than this. */
const STARRED_SESSIONS_LIMIT = 500;

function connectionKind(
  shellKind: CockpitShellState["kind"],
): "online" | "offline" | "error" {
  if (shellKind === "offline") return "offline";
  if (shellKind === "error") return "error";
  return "online";
}

/**
 * Cockpit composition boundary for project/session navigation. Existing feed
 * hooks fill the source summary store; the Cockpit only projects those compact
 * records and never asks for transcript detail to draw its catalog.
 */
export function useCockpitCatalog(
  shellKind: CockpitShellState["kind"],
): CockpitCatalogData {
  const runtime = useCurrentSourceRuntime();
  const organization = useCockpitOrganization();
  const projectsFeed = useProjects();
  const sessionsFeed = useGlobalSessionsFeed({
    limit: 100,
    includeStats: false,
  });
  // Pinned sessions stay pinned however old they are, so they need their own
  // feed: the recent page above holds only the newest sessions, and a pin last
  // touched before that window silently dropped out of the sidebar.
  const starredFeed = useGlobalSessionsFeed({
    starred: true,
    limit: STARRED_SESSIONS_LIMIT,
    includeStats: false,
  });
  const sessions = useSessionCollectionQueryRecords(sessionsFeed.query);
  const starredRecords = useSessionCollectionQueryRecords(starredFeed.query);
  const starredSessions = useMemo(() => {
    // Both feeds read the same entity store, so one id is one record.
    const byId = new Map<string, (typeof sessions)[number]>();
    for (const session of [...starredRecords, ...sessions]) {
      byId.set(session.id, session);
    }
    return [...byId.values()].filter(
      (session) => session.isStarred === true && session.isArchived !== true,
    );
  }, [sessions, starredRecords]);
  const ordered = useSidebarSessionOrder(sessions, starredSessions);
  const orderedSessions = useMemo(
    () => [...ordered.starred, ...ordered.recent, ...ordered.older],
    [ordered.starred, ordered.recent, ordered.older],
  );
  const summaryState = useClientSummaryState();
  const hasExternal = orderedSessions.some(
    (session) => session.ownership?.owner === "external",
  );
  const [now, setNow] = useState(() => Date.now());
  // External freshness expires with time alone, without another event.
  useEffect(() => {
    if (!hasExternal) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [hasExternal]);
  const catalog = useMemo(
    () =>
      createCockpitCatalog({
        sourceKey: runtime.sourceKey,
        projects: projectsFeed.projects,
        sessions: orderedSessions,
        orderedSessionIds: orderedSessions.map((session) => session.id),
        providerRuntimeBySessionId: summaryState.providerRuntime.bySessionId,
        connection: connectionKind(shellKind),
        now,
      }),
    [
      now,
      runtime.sourceKey,
      projectsFeed.projects,
      orderedSessions,
      summaryState.providerRuntime.bySessionId,
      shellKind,
    ],
  );

  return {
    catalog,
    error: projectsFeed.error ?? sessionsFeed.error ?? starredFeed.error,
    loading: projectsFeed.loading || sessionsFeed.loading,
    hasMore: sessionsFeed.hasMore,
    loadMore: sessionsFeed.loadMore,
    organization,
  };
}
