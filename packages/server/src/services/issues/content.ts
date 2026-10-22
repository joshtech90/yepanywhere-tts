import { setTimeout as delay } from "node:timers/promises";
import {
  DEFAULT_ISSUE_CONTENT_TTL_SECONDS,
  type IssueSearchResult,
  type IssueSettings,
} from "@yep-anywhere/shared";
import type { IssueContent, IssueStore } from "./IssueStore.js";
import type { IssueCredentials } from "./credentials.js";

const RETRY = 5 * 60_000;
const MAX_RESPONSE = 2 * 1024 * 1024;

/** Jira v3 description is ADF, including text-less smart-link cards. */
export function jiraDescription(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  const parts: string[] = [];
  let nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (!value || typeof value !== "object" || depth > 64 || ++nodes > 100_000)
      throw new Error("Invalid or oversized Jira description");
    const node = value as Record<string, unknown>;
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (typeof node.text === "string") parts.push(node.text);
    if (
      (node.type === "inlineCard" || node.type === "blockCard") &&
      typeof attrs?.url === "string"
    )
      parts.push(attrs.url);
    if (node.type === "mention" && typeof attrs?.text === "string")
      parts.push(attrs.text);
    if (node.type === "emoji" && typeof attrs?.shortName === "string")
      parts.push(attrs.shortName);
    if (Array.isArray(node.content))
      for (const child of node.content) visit(child, depth + 1);
    if (Array.isArray(node.marks))
      for (const mark of node.marks) {
        if (
          mark?.type === "link" &&
          typeof mark.attrs?.href === "string" &&
          mark.attrs.href !== node.text
        )
          parts.push(` (${mark.attrs.href})`);
      }
    if (
      [
        "paragraph",
        "heading",
        "hardBreak",
        "listItem",
        "tableRow",
        "codeBlock",
        "blockquote",
      ].includes(String(node.type))
    )
      parts.push("\n");
    if (node.type === "tableCell" || node.type === "tableHeader")
      parts.push("\t");
  }
  visit(value, 0);
  return parts.join("").trim();
}

export async function readTrackerJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("Empty tracker response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE)
        throw new Error("Tracker response exceeds 2 MiB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid tracker response");
  return value as Record<string, unknown>;
}

/** Finite, explicit refresh. Durable per-item results make restart/rescan cheap. */
export class IssueContentRefresher {
  private running?: Promise<void>;
  private abort = new AbortController();
  private closed = false;
  private pendingSelection?: string;
  private progress: NonNullable<IssueSearchResult["contentRefresh"]> = {
    active: false,
    checked: 0,
    skipped: 0,
    failed: 0,
    error: null,
  };
  constructor(
    private readonly store: IssueStore,
    private readonly deps: {
      settings: () => IssueSettings;
      credentials: IssueCredentials;
      fetch?: typeof fetch;
      now?: () => number;
      intervalMs?: number;
    },
  ) {}

  status() {
    return { ...this.progress };
  }
  start(force = false, id = ""): void {
    if (this.closed || !this.deps.settings().enabled) return;
    if (this.running) {
      // One latest selected item, not an unbounded click queue.
      if (id) this.pendingSelection = id;
      return;
    }
    this.progress = {
      active: true,
      checked: 0,
      skipped: 0,
      failed: 0,
      error: null,
    };
    this.running = this.pass(force, id)
      .catch((error: unknown) => {
        if (!this.closed)
          this.progress.error =
            error instanceof Error ? error.message : "Refresh failed";
      })
      .finally(() => {
        this.progress.active = false;
        this.running = undefined;
        const selected = this.pendingSelection;
        this.pendingSelection = undefined;
        if (selected) this.start(true, selected);
      });
  }
  async drain(): Promise<void> {
    while (this.running) await this.running;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    await this.running;
  }

  private async pass(force: boolean, id: string): Promise<void> {
    const backoff = this.store.contentBackoff();
    if (backoff > (this.deps.now ?? Date.now)()) {
      this.progress.error = `Tracker rate limit: retry after ${new Date(backoff).toISOString()}`;
      return;
    }
    let after = "";
    let requested = false;
    const settings = this.deps.settings();
    const ttl =
      settings.contentTtlSeconds === null
        ? Infinity
        : (settings.contentTtlSeconds ?? DEFAULT_ISSUE_CONTENT_TTL_SECONDS) *
          1000;
    const configuration = JSON.stringify(settings);
    const current = () =>
      !this.closed &&
      this.deps.settings().enabled &&
      JSON.stringify(this.deps.settings()) === configuration;
    while (current()) {
      const rows = this.store.contentCandidates(after, id);
      if (!rows.length) return;
      for (const row of rows) {
        if (!current()) return;
        after = row.id;
        const now = (this.deps.now ?? Date.now)();
        const freshness = this.store.contentFreshness(row.id);
        if (
          freshness &&
          (freshness.retryAfter > now ||
            (!force &&
              freshness.state !== "failed" &&
              now - freshness.checkedAt < ttl))
        ) {
          ++this.progress.skipped;
          continue;
        }
        if (requested)
          await delay(this.deps.intervalMs ?? 1000, undefined, {
            signal: this.abort.signal,
          });
        if (!current()) return;
        requested = true;
        const saved = this.store.content(row.id);
        const value = await this.fetchContent(row, saved, settings);
        if (!current()) return;
        if (
          value.state === "available" &&
          saved &&
          value.title === saved.title &&
          value.body === saved.body &&
          value.etag === saved.etag &&
          value.modified === saved.modified
        )
          this.store.validateContent(row.id, value.checkedAt);
        else this.store.saveContent(row.id, value);
        ++this.progress.checked;
        if (value.state === "failed") ++this.progress.failed;
        // A provider backoff stops the whole finite pass. A later user refresh
        // resumes via the per-item cache, without holding an idle retry timer.
        if (this.store.contentBackoff() > now) {
          this.progress.error = `Tracker rate limit: retry after ${new Date(value.retryAfter).toISOString()}`;
          return;
        }
      }
      // Yield even a wholly cached page, keeping server input acknowledgement live.
      await delay(0, undefined, { signal: this.abort.signal });
    }
  }

  private async fetchContent(
    row: { url: string; provider: string; key: string },
    saved: IssueContent | null,
    settings: IssueSettings,
  ): Promise<IssueContent> {
    const now = (this.deps.now ?? Date.now)();
    const failed: IssueContent = {
      title: saved?.title ?? null,
      body: saved?.body ?? null,
      checkedAt: saved?.checkedAt ?? 0,
      retryAfter: now + RETRY,
      state: "failed",
      etag: saved?.etag ?? null,
      modified: saved?.modified ?? null,
    };
    try {
      const source = new URL(row.url);
      if (source.protocol !== "https:" || source.username || source.password)
        return failed;
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "yep-anywhere",
      };
      let url: string;
      if (row.provider === "jira") {
        const base =
          source.origin +
          source.pathname.slice(0, source.pathname.lastIndexOf("/browse/"));
        url = `${base}/rest/api/3/issue/${encodeURIComponent(row.key)}?fields=summary,description`;
        // The configured key must never leave its exact Jira site/context path.
        if (base === settings.confirmation?.jiraSite?.replace(/\/+$/, "")) {
          const credential = await this.deps.credentials.resolve("jira");
          if (credential)
            headers.Authorization = `Basic ${Buffer.from(`${settings.confirmation?.jiraEmail ?? ""}:${credential.token}`).toString("base64")}`;
        }
      } else if (
        row.provider === "github" &&
        source.hostname === "github.com"
      ) {
        const match = row.key.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        if (!match) return failed;
        url = `https://api.github.com/repos/${match[1]}/${match[2]}/issues/${match[3]}`;
        const credential = await this.deps.credentials.resolve("github");
        if (credential) headers.Authorization = `Bearer ${credential.token}`;
        headers.Accept = "application/vnd.github+json";
        headers["X-GitHub-Api-Version"] = "2022-11-28";
      } else return failed;
      if (saved?.body !== null && saved?.body !== undefined) {
        if (saved.etag) headers["If-None-Match"] = saved.etag;
        else if (saved.modified) headers["If-Modified-Since"] = saved.modified;
      }
      const response = await (this.deps.fetch ?? fetch)(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(10_000),
        ]),
      });
      if (response.status === 304 && saved?.body !== null && saved) {
        await response.body?.cancel();
        return { ...saved, state: "available", checkedAt: now, retryAfter: 0 };
      }
      if (response.status === 404 || response.status === 410) {
        await response.body?.cancel();
        return {
          title: null,
          body: null,
          state: "unavailable",
          checkedAt: now,
          retryAfter: 0,
          etag: null,
          modified: null,
        };
      }
      if (!response.ok) {
        if (
          response.status === 429 ||
          (response.status === 403 &&
            response.headers.get("x-ratelimit-remaining") === "0")
        ) {
          const retry = response.headers.get("retry-after");
          const until =
            retry && /^\d+$/.test(retry)
              ? now + Number(retry) * 1000
              : Date.parse(retry ?? "");
          const reset =
            Number(response.headers.get("x-ratelimit-reset")) * 1000;
          failed.retryAfter = Math.max(
            now + RETRY + 1,
            Number.isFinite(until) && until <= 8.64e15 ? until : 0,
            Number.isFinite(reset) && reset <= 8.64e15 ? reset : 0,
          );
          this.store.contentBackoff(failed.retryAfter);
        }
        await response.body?.cancel();
        return failed;
      }
      const data = await readTrackerJson(response);
      const fields = data.fields as Record<string, unknown> | undefined;
      if (row.provider === "jira" && (!fields || !("description" in fields)))
        throw new Error("Jira omitted the requested description field");
      const title = row.provider === "jira" ? fields?.summary : data.title;
      const body =
        row.provider === "jira"
          ? jiraDescription(fields?.description)
          : data.body;
      if (
        typeof title !== "string" ||
        (body !== null && typeof body !== "string")
      )
        throw new Error("Missing tracker content");
      return {
        title,
        body: body ?? "",
        checkedAt: now,
        retryAfter: 0,
        state: "available",
        etag: response.headers.get("etag"),
        modified: response.headers.get("last-modified"),
      };
    } catch (error) {
      if (this.closed) throw error;
      return failed;
    }
  }
}
