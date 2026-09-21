/**
 * Resolve which project a session belongs to, who started it, and whether it
 * is still fresh enough for a limited user to join.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Authorization.
 *
 * A live process is authoritative and cheap. A session with no process is
 * looked up in the session catalog, whose rows are cached here for a few
 * seconds so a burst of session requests costs one read.
 */

import { isSessionFreshForJoin } from "@yep-anywhere/shared";

export interface SessionAccessFacts {
  projectId: string;
  provider: string | undefined;
  lastActivityMs: number | null;
  createdByUser: string | undefined;
}

export interface SessionAccessResolverDeps {
  /** Live process lookup, authoritative when the session is running. */
  getLiveSession: (sessionId: string) =>
    | {
        projectId: string;
        provider?: string;
        lastActivityMs?: number | null;
      }
    | undefined;
  /** Catalog rows for sessions with no live process. */
  readCatalogRows: () => Promise<
    ReadonlyArray<{
      sessionId: string;
      projectId: string;
      catalogFamily?: string;
      updatedAt?: string;
    }>
  >;
  /** Session metadata, for the user recorded at creation. */
  getSessionMetadata: (
    sessionId: string,
  ) => { createdByUser?: string; workingProjectId?: string } | undefined;
  now?: () => number;
}

const CATALOG_CACHE_TTL_MS = 5_000;

export class SessionAccessResolver {
  private catalog = new Map<
    string,
    { projectId: string; provider?: string; updatedAtMs: number | null }
  >();
  private catalogLoadedAt = 0;
  private catalogLoad: Promise<void> | null = null;

  constructor(private readonly deps: SessionAccessResolverDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async refreshCatalog(): Promise<void> {
    if (this.now() - this.catalogLoadedAt < CATALOG_CACHE_TTL_MS) return;
    this.catalogLoad ??= (async () => {
      try {
        const rows = await this.deps.readCatalogRows();
        const next = new Map<
          string,
          { projectId: string; provider?: string; updatedAtMs: number | null }
        >();
        for (const row of rows) {
          const updatedAtMs = row.updatedAt
            ? Date.parse(row.updatedAt)
            : Number.NaN;
          next.set(row.sessionId, {
            projectId: row.projectId,
            provider: row.catalogFamily,
            updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
          });
        }
        this.catalog = next;
        this.catalogLoadedAt = this.now();
      } finally {
        this.catalogLoad = null;
      }
    })();
    await this.catalogLoad;
  }

  /** Facts about a session, or null when it resolves to no project. */
  async resolve(sessionId: string): Promise<SessionAccessFacts | null> {
    const metadata = this.deps.getSessionMetadata(sessionId);
    const live = this.deps.getLiveSession(sessionId);
    if (live) {
      return {
        projectId: metadata?.workingProjectId ?? live.projectId,
        provider: live.provider,
        lastActivityMs: live.lastActivityMs ?? this.now(),
        createdByUser: metadata?.createdByUser,
      };
    }

    let row = this.catalog.get(sessionId);
    if (!row) {
      await this.refreshCatalog();
      row = this.catalog.get(sessionId);
    }
    if (!row) {
      // A pinned project still identifies an otherwise unknown session.
      if (metadata?.workingProjectId) {
        return {
          projectId: metadata.workingProjectId,
          provider: undefined,
          lastActivityMs: null,
          createdByUser: metadata.createdByUser,
        };
      }
      return null;
    }
    return {
      projectId: metadata?.workingProjectId ?? row.projectId,
      provider: row.provider,
      lastActivityMs: row.updatedAtMs,
      createdByUser: metadata?.createdByUser,
    };
  }

  /** Whether a limited user may send turns to this session right now. */
  canJoin(
    facts: SessionAccessFacts,
    options: { username: string; offsetMinutes: number },
  ): boolean {
    if (facts.createdByUser === options.username) return true;
    return isSessionFreshForJoin({
      provider: facts.provider,
      lastActivityMs: facts.lastActivityMs,
      offsetMinutes: options.offsetMinutes,
      nowMs: this.now(),
    });
  }
}
