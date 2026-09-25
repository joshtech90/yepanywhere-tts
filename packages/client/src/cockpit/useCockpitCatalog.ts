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
  const sessions = useSessionCollectionQueryRecords(sessionsFeed.query);
  const starredSessions = useMemo(
    () =>
      sessions.filter(
        (session) => session.isStarred === true && session.isArchived !== true,
      ),
    [sessions],
  );
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
    error: projectsFeed.error ?? sessionsFeed.error,
    loading: projectsFeed.loading || sessionsFeed.loading,
    hasMore: sessionsFeed.hasMore,
    loadMore: sessionsFeed.loadMore,
    organization,
  };
}
