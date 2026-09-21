import type { IssueSettings } from "@yep-anywhere/shared";
import type { IssueStore, PendingConfirmation } from "./IssueStore.js";
import type { IssueCredentials } from "./credentials.js";

/**
 * Asks a tracker once whether a newly seen reference is real.
 *
 * Shape alone cannot separate `PROJ-7` from `UTF-8`, and an installation that
 * already holds credentials can settle it. The policy is deliberately meek:
 * one query per reference, ever. A pending row is written when a reference is
 * first captured, this worker answers it, and the verdict stays. Nothing
 * retries on a timer, so an unreachable tracker or an expired key costs one
 * request rather than a standing poll; an explicit recheck is the only way to
 * ask again.
 */

/** Bounds one drain so a large first import cannot become a request storm. */
const BATCH = 20;
const TIMEOUT_MS = 10_000;

export type ConfirmationState =
  | "pending"
  | "confirmed"
  | "rejected"
  | "unreachable";

export interface ConfirmationVerdict {
  state: Exclude<ConfirmationState, "pending">;
  title?: string;
  detail?: string;
}

export interface IssueConfirmerDeps {
  settings: () => IssueSettings;
  credentials: IssueCredentials;
  fetch?: typeof fetch;
}

/** The site a bare key belongs to, or null when none is configured. */
function jiraBase(settings: IssueSettings): string | null {
  const site = settings.confirmation?.jiraSite?.trim().replace(/\/+$/, "");
  return site || null;
}

export class IssueConfirmer {
  private draining?: Promise<void>;
  private again = false;
  private closed = false;
  constructor(
    private readonly store: IssueStore,
    private readonly deps: IssueConfirmerDeps,
  ) {}

  private get fetcher(): typeof fetch {
    return this.deps.fetch ?? fetch;
  }

  private enabled(): boolean {
    const settings = this.deps.settings();
    return Boolean(settings.enabled && settings.confirmation?.enabled);
  }

  /** Answer one reference. Never throws; an error is a verdict, not a crash. */
  private async ask(row: PendingConfirmation): Promise<ConfirmationVerdict> {
    const settings = this.deps.settings();
    const provider = row.provider === "jira" ? "jira" : "github";
    const credential = await this.deps.credentials.resolve(provider);
    if (!credential)
      return { state: "unreachable", detail: `No ${provider} credential` };
    const request = this.request(row, settings);
    if (!request)
      return {
        state: "unreachable",
        detail: "No Jira site is configured for keys seen without a URL",
      };
    try {
      const response = await this.fetcher(request.url, {
        headers: {
          ...request.headers(credential.token, settings),
          "User-Agent": "yep-anywhere",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404 || response.status === 410)
        return { state: "rejected", detail: "The tracker has no such item" };
      if (!response.ok)
        return { state: "unreachable", detail: `HTTP ${response.status}` };
      const body = (await response.json()) as Record<string, unknown>;
      return { state: "confirmed", title: request.title(body) };
    } catch (error) {
      return {
        state: "unreachable",
        detail: error instanceof Error ? error.message : "Lookup failed",
      };
    }
  }

  /** Where to ask, how to authenticate, and where the summary lives. */
  private request(
    row: PendingConfirmation,
    settings: IssueSettings,
  ): {
    url: string;
    headers: (token: string, settings: IssueSettings) => Record<string, string>;
    title: (body: Record<string, unknown>) => string | undefined;
  } | null {
    if (row.provider === "jira") {
      const base = jiraBase(settings);
      if (!base || !/^[A-Z][A-Z0-9_]+-[1-9]\d*$/.test(row.refKey)) return null;
      return {
        url: `${base}/rest/api/3/issue/${encodeURIComponent(row.refKey)}?fields=summary`,
        headers: (token, current) => ({
          // Jira Cloud pairs the account email with the API token.
          Authorization: `Basic ${Buffer.from(
            `${current.confirmation?.jiraEmail ?? ""}:${token}`,
          ).toString("base64")}`,
          Accept: "application/json",
        }),
        title: (body) =>
          typeof (body.fields as { summary?: unknown } | undefined)?.summary ===
          "string"
            ? ((body.fields as { summary: string }).summary satisfies string)
            : undefined,
      };
    }
    const parts = row.refKey.match(/^([^/\s]+)\/([^/\s#]+)#([1-9]\d*)$/);
    if (!parts) return null;
    return {
      // The issues endpoint answers for pull requests too.
      url: `https://api.github.com/repos/${parts[1]}/${parts[2]}/issues/${parts[3]}`,
      headers: (token) => ({
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      }),
      title: (body) =>
        typeof body.title === "string" ? body.title : undefined,
    };
  }

  /** Queue one reference to be asked about again, by explicit request only. */
  recheck(projectId: string, provider: string, refKey: string): void {
    this.store.requeueConfirmation(projectId, provider, refKey);
  }

  /** Run a drain, coalescing concurrent callers into one pass. */
  schedule(): void {
    if (this.closed || !this.enabled()) return;
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = this.pass()
      .catch(() => {})
      .finally(() => {
        this.draining = undefined;
        if (this.again) {
          this.again = false;
          this.schedule();
        }
      });
  }

  /**
   * Awaitable drain, used by tests and by an explicit recheck. Coalesced like
   * `schedule()` and then awaited to quiescence: a caller arriving while a
   * pass is in flight adds a follow-up pass rather than a second loop over the
   * same pending rows, which would ask the tracker twice about each of them.
   */
  async drain(): Promise<void> {
    this.schedule();
    while (this.draining) await this.draining;
  }

  /** One pass over the pending rows, `BATCH` at a time. */
  private async pass(): Promise<void> {
    while (!this.closed && this.enabled()) {
      const pending = this.store.pendingConfirmations(BATCH);
      if (!pending.length) return;
      for (const row of pending) {
        if (this.closed || !this.enabled()) return;
        this.store.recordConfirmation(row, await this.ask(row));
      }
    }
  }

  /** Wait for an in-flight pass; no new work starts afterwards. */
  async close(): Promise<void> {
    this.closed = true;
    await this.draining;
  }
}
