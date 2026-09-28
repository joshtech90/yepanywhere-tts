/**
 * Resolve which project a session belongs to, who started it, whether it runs
 * sandboxed, and whether it is still fresh enough for a limited user to join.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Authorization.
 *
 * A live process is authoritative for the project and cheap. A session with no
 * process is looked up in the session catalog, whose rows are cached here for
 * a few seconds so a burst of session requests costs one read. Last activity
 * is the process's last provider message, else the catalog's last update;
 * a session with neither is never fresh.
 */

import { isSessionFreshForJoin } from "@yep-anywhere/shared";

export interface SessionAccessFacts {
  projectId: string;
  provider: string | undefined;
  lastActivityMs: number | null;
  createdByUser: string | undefined;
  /**
   * Whether the session runs in the project-write sandbox: the live
   * process's enforced level, else the level its last launch recorded.
   */
  sandboxed: boolean;
}

export interface SessionAccessResolverDeps {
  /** Live process lookup, authoritative when the session is running. */
  getLiveSession: (sessionId: string) =>
    | {
        projectId: string;
        provider?: string;
        /** Last provider message; null before the process has seen one. */
        lastActivityMs?: number | null;
        /** The process enforces the project-write sandbox. */
        sandboxed?: boolean;
      }
    | undefined;
  /** Session catalog rows, for sessions with no live process. */
  readCatalogRows: () => Promise<
    ReadonlyArray<{
      sessionId: string;
      projectId: string;
      provider?: string;
      updatedAt?: string;
    }>
  >;
  /** Session metadata: the user recorded at creation and the sandbox level. */
  getSessionMetadata: (sessionId: string) =>
    | {
        createdByUser?: string;
        workingProjectId?: string;
        sandboxLevel?: string;
      }
    | undefined;
  now?: () => number;
}

const CATALOG_CACHE_TTL_MS = 5_000;

interface CatalogFacts {
  projectId: string;
  provider?: string;
  updatedAtMs: number | null;
}

export class SessionAccessResolver {
  private catalog = new Map<string, CatalogFacts>();
  /** Session ids whose catalog rows name more than one project. */
  private ambiguous = new Set<string>();
  private catalogAttemptedAt = Number.NEGATIVE_INFINITY;
  private catalogLoad: Promise<void> | null = null;

  constructor(private readonly deps: SessionAccessResolverDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Re-read the catalog at most once per TTL, success or failure, so a
   * failing or unknown-id stream costs one read per interval.
   */
  private async refreshCatalog(): Promise<void> {
    if (
      !this.catalogLoad &&
      this.now() - this.catalogAttemptedAt < CATALOG_CACHE_TTL_MS
    ) {
      return;
    }
    this.catalogLoad ??= (async () => {
      this.catalogAttemptedAt = this.now();
      try {
        const rows = await this.deps.readCatalogRows();
        const next = new Map<string, CatalogFacts>();
        const ambiguous = new Set<string>();
        for (const row of rows) {
          const updatedAtMs = row.updatedAt
            ? Date.parse(row.updatedAt)
            : Number.NaN;
          const facts: CatalogFacts = {
            projectId: row.projectId,
            provider: row.provider,
            updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
          };
          const prior = next.get(row.sessionId);
          if (prior && prior.projectId !== facts.projectId) {
            ambiguous.add(row.sessionId);
          }
          if (!prior || (facts.updatedAtMs ?? 0) > (prior.updatedAtMs ?? 0)) {
            next.set(row.sessionId, facts);
          }
        }
        this.catalog = next;
        this.ambiguous = ambiguous;
      } finally {
        this.catalogLoad = null;
      }
    })();
    await this.catalogLoad;
  }

  private catalogFacts(sessionId: string): CatalogFacts | undefined {
    return this.ambiguous.has(sessionId)
      ? undefined
      : this.catalog.get(sessionId);
  }

  /** Whether the catalog could add a project or activity time to these facts. */
  private needsCatalog(
    sessionId: string,
    live: ReturnType<SessionAccessResolverDeps["getLiveSession"]>,
  ): boolean {
    if (this.catalog.has(sessionId)) return false;
    return !live || live.lastActivityMs == null;
  }

  /** Facts about a session, or null when it resolves to no project. */
  async resolve(sessionId: string): Promise<SessionAccessFacts | null> {
    const metadata = this.deps.getSessionMetadata(sessionId);
    const live = this.deps.getLiveSession(sessionId);
    if (this.needsCatalog(sessionId, live)) {
      await this.refreshCatalog();
    }
    return this.factsFrom(sessionId, metadata, live);
  }

  /**
   * Facts from what is already in memory — the live process, session
   * metadata, and the last catalog read — for callers that cannot wait, such
   * as per-event activity filtering. A session the last read lacked starts a
   * background read, so its later events resolve.
   */
  resolveKnown(sessionId: string): SessionAccessFacts | null {
    const live = this.deps.getLiveSession(sessionId);
    if (this.needsCatalog(sessionId, live)) {
      this.refreshCatalog().catch((error: unknown) => {
        console.warn("[SessionAccess] Session catalog read failed:", error);
      });
    }
    return this.factsFrom(
      sessionId,
      this.deps.getSessionMetadata(sessionId),
      live,
    );
  }

  private factsFrom(
    sessionId: string,
    metadata: ReturnType<SessionAccessResolverDeps["getSessionMetadata"]>,
    live: ReturnType<SessionAccessResolverDeps["getLiveSession"]>,
  ): SessionAccessFacts | null {
    const row = this.catalogFacts(sessionId);
    if (live) {
      return {
        projectId: metadata?.workingProjectId ?? live.projectId,
        provider: live.provider,
        lastActivityMs: live.lastActivityMs ?? row?.updatedAtMs ?? null,
        createdByUser: metadata?.createdByUser,
        // What the running process enforces, whatever its metadata says.
        sandboxed: live.sandboxed === true,
      };
    }

    const sandboxed = metadata?.sandboxLevel === "project-write";
    if (!row) {
      // A pinned project still identifies an otherwise unknown session.
      if (metadata?.workingProjectId) {
        return {
          projectId: metadata.workingProjectId,
          provider: undefined,
          lastActivityMs: null,
          createdByUser: metadata.createdByUser,
          sandboxed,
        };
      }
      return null;
    }
    return {
      projectId: metadata?.workingProjectId ?? row.projectId,
      provider: row.provider,
      lastActivityMs: row.updatedAtMs,
      createdByUser: metadata?.createdByUser,
      sandboxed,
    };
  }

  /**
   * Whether the session is fresh enough for a limited user to send turns to
   * it right now. Freshness alone: the middleware also requires the session
   * to run sandboxed.
   */
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
