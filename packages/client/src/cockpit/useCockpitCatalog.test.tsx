import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCockpitCatalog } from "./useCockpitCatalog";

const records = vi.hoisted(() => ({
  recent: [
    {
      id: "recent",
      projectId: "atlas",
      title: "Recent work",
      provider: "claude",
      updatedAt: "2026-11-22T12:00:00.000Z",
      ownership: { owner: "none" },
    },
    {
      id: "unpinned-old",
      projectId: "atlas",
      title: "Just unpinned",
      provider: "claude",
      isStarred: false,
      updatedAt: "2026-11-21T12:00:00.000Z",
      ownership: { owner: "none" },
    },
  ],
  starred: [
    {
      id: "pinned-old",
      projectId: "atlas",
      title: "Offene Punkte",
      provider: "claude",
      isStarred: true,
      updatedAt: "2026-11-09T12:00:00.000Z",
      ownership: { owner: "none" },
    },
    {
      id: "pinned-archived",
      projectId: "atlas",
      title: "Archived pin",
      provider: "claude",
      isStarred: true,
      isArchived: true,
      updatedAt: "2026-11-01T12:00:00.000Z",
      ownership: { owner: "none" },
    },
  ],
}));

const feedOptions = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({ sourceKey: "local" }),
}));

vi.mock("../hooks/useProjects", () => ({
  useProjects: () => ({ loading: false, error: null, projects: [] }),
}));

vi.mock("./useCockpitOrganization", () => ({
  useCockpitOrganization: () => ({}),
}));

vi.mock("../hooks/useGlobalSessionsFeed", () => ({
  useGlobalSessionsFeed: (options: Record<string, unknown>) => {
    feedOptions.push(options);
    return {
      query: options.starred ? "starred" : "recent",
      error: null,
      loading: false,
      hasMore: false,
      loadMore: vi.fn(async () => {}),
    };
  },
}));

vi.mock("../lib/clientSummaryStore", () => ({
  useClientSummaryState: () => ({
    providerRuntime: { bySessionId: new Map() },
  }),
  useSessionCollectionQueryRecords: (query: "recent" | "starred") =>
    records[query],
}));

vi.mock("../hooks/useSidebarSessionOrder", () => ({
  useSidebarSessionOrder: (
    sessions: Array<{ id: string; isStarred?: boolean }>,
    starred: Array<{ id: string }>,
  ) => ({
    starred,
    recent: sessions.filter((session) => !session.isStarred),
    older: [],
  }),
}));

const catalogInput = vi.hoisted(() => ({
  orderedSessionIds: [] as string[],
}));

vi.mock("./core/catalog", () => ({
  createCockpitCatalog: (input: { orderedSessionIds: string[] }) => {
    catalogInput.orderedSessionIds = input.orderedSessionIds;
    return {};
  },
}));

describe("useCockpitCatalog", () => {
  it("keeps pins that fell out of the recent page", () => {
    renderHook(() => useCockpitCatalog("ready" as never));

    expect(feedOptions.some((options) => options.starred === true)).toBe(true);
    // The old pin comes first; archived pins and unpinned rows stay out of
    // the pinned section.
    expect(catalogInput.orderedSessionIds).toEqual([
      "pinned-old",
      "recent",
      "unpinned-old",
    ]);
  });
});
