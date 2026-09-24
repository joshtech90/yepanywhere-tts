import {
  ALL_PROVIDERS,
  SESSION_CONTENT_SEARCH_CAPABILITY,
  providerSupportsBoundedTurnSearch,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useEffect, useMemo, useRef } from "react";
import type { GlobalSessionItem } from "../api/client";
import { useContentSearch } from "../components/session-search/useContentSearch";
import type { SearchField } from "../components/session-search/model";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useGlobalSessionsFeed } from "../hooks/useGlobalSessionsFeed";
import { useProviders } from "../hooks/useProviders";
import { useVersion } from "../hooks/useVersion";
import { useSessionCollectionQueryRecords } from "../lib/clientSummaryStore";
import { sessionCollectionRecordsToGlobalSessionItems } from "../lib/sessionCollectionRecords";
import {
  createCockpitSearchResults,
  type CockpitSearchResult,
} from "./core/search";

export type CockpitSearchSupport = "checking" | "supported" | "title-only";

export interface CockpitSearchData {
  results: CockpitSearchResult[];
  support: CockpitSearchSupport;
  loadedSessionCount: number;
  catalogLoading: boolean;
  catalogHasMore: boolean;
  contentRunning: boolean;
  partialSessions: Array<{
    session: GlobalSessionItem;
    reason: string;
  }>;
  unsupportedProviderSessionCount: number;
  error: Error | null;
}

export function useCockpitSearch(
  query: string,
  fields: SearchField[],
): CockpitSearchData {
  const runtime = useCurrentSourceRuntime();
  const feed = useGlobalSessionsFeed({
    includeArchived: true,
    includeStats: false,
    limit: 500,
  });
  const records = useSessionCollectionQueryRecords(feed.query);
  const sessions = useMemo(
    () => sessionCollectionRecordsToGlobalSessionItems(records),
    [records],
  );
  const { version, loading: versionLoading } = useVersion();
  const { providers } = useProviders();
  const support: CockpitSearchSupport = version
    ? serverHasCapability(version, SESSION_CONTENT_SEARCH_CAPABILITY)
      ? "supported"
      : "title-only"
    : versionLoading
      ? "checking"
      : "title-only";
  const turnSearchProviders = useMemo(
    () =>
      new Set(
        ALL_PROVIDERS.filter((name) =>
          providerSupportsBoundedTurnSearch(
            name,
            providers.find((provider) => provider.name === name)
              ?.supportsBoundedTurnSearch,
          ),
        ),
      ),
    [providers],
  );
  const contentCandidates = useMemo(
    () =>
      sessions.filter((session) =>
        turnSearchProviders.has(session.provider),
      ),
    [sessions, turnSearchProviders],
  );
  const effectiveFields = useMemo(
    () =>
      support === "supported"
        ? fields
        : fields.filter((field) => field === "title"),
    [fields, support],
  );
  const scan = useContentSearch(
    contentCandidates,
    query,
    effectiveFields,
    support === "supported",
  );
  const ranking = useRef({
    sourceKey: runtime.sourceKey,
    query,
    order: new Map<string, number>(),
  });
  if (
    ranking.current.sourceKey !== runtime.sourceKey ||
    ranking.current.query !== query
  ) {
    ranking.current = {
      sourceKey: runtime.sourceKey,
      query,
      order: new Map(),
    };
  }
  const discoveryOrder = ranking.current.order;
  const results = useMemo(
    () =>
      createCockpitSearchResults({
        sessions,
        query,
        fields: effectiveFields,
        contentMatches: scan.matches,
        discoveryOrder,
      }),
    [sessions, query, effectiveFields, scan.matches, discoveryOrder],
  );
  const wantsTurns = fields.some((field) => field !== "title");
  const unsupportedProviderSessionCount = wantsTurns
    ? sessions.filter(
        (session) => !turnSearchProviders.has(session.provider),
      ).length
    : 0;
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const partialSessions = useMemo(
    () =>
      [...scan.partial].flatMap(([sessionId, reason]) => {
        const session = sessionsById.get(sessionId);
        return session ? [{ session, reason }] : [];
      }),
    [scan.partial, sessionsById],
  );

  useEffect(() => {
    if (feed.hasMore && !feed.loading && !feed.error) {
      void feed.loadMore();
    }
  }, [feed.hasMore, feed.loading, feed.error, feed.loadMore]);

  return {
    results,
    support,
    loadedSessionCount: sessions.length,
    catalogLoading: feed.loading,
    catalogHasMore: feed.hasMore,
    contentRunning: scan.running,
    partialSessions,
    unsupportedProviderSessionCount,
    error: feed.error,
  };
}
