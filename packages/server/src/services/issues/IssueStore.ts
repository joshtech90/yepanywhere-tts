import { createHash, randomUUID } from "node:crypto";
import type {
  SqliteDatabase,
  SqliteRow,
  SqliteValue,
} from "../../storage/sqlite.js";
import type { VisibleMessageText } from "../../sessions/message-text.js";
import {
  EXTRACTOR_VERSION,
  extractIssueReferences,
  issueUrl,
  issueExcerpt,
} from "./extract.js";

import {
  DEFAULT_ISSUE_SETTINGS,
  DEFAULT_JIRA_KEY_BLOCKLIST,
  type IssueItem,
  type IssueSort,
  type IssueEvidence,
  type IssueSettings,
} from "@yep-anywhere/shared";
export type { IssueItem, IssueEvidence } from "@yep-anywhere/shared";
export interface IssueSource {
  sourceVersion?: string;
  sessionId: string;
  projectId: string;
}
/** The columns a re-admission would rewrite, as the queue currently holds them. */
export interface AdmittedJob {
  projectId: string;
  priority: number;
  state: string;
  /** Serialized catalog row, compared verbatim against the candidate's. */
  source: string;
}
/** One candidate session the worker may pick up, as the queue holds it. */
export interface QueuedJob {
  sessionId: string;
  sourceVersion: string;
  /** Acquisition position to resume from, absent before the first read. */
  cursor?: string;
  /** Serialized catalog row; `"null"` for a viewed window with no catalog row. */
  source: string;
}
/** A candidate admitted by a catalog sweep. */
export interface JobAdmission {
  sessionId: string;
  projectId: string;
  sourceVersion: string;
  source: string;
  priority: number;
}
/** A tracker reference awaiting its one confirmation query. */
export interface PendingConfirmation {
  projectId: string;
  provider: string;
  refKey: string;
}
const escaped = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
export const unresolvedId = (project: string, key: string) =>
  `ref:${JSON.stringify([project, key])}`;

/** One connection owner; all statements finalize, all mutations commit synchronously. */
export class IssueStore {
  constructor(
    readonly database: SqliteDatabase,
    /** Read per capture, so a settings change applies to the next message. */
    private readonly settings: () => IssueSettings = () =>
      DEFAULT_ISSUE_SETTINGS,
  ) {}
  private rows(sql: string, ...values: SqliteValue[]): SqliteRow[] {
    const s = this.database.prepare(sql);
    try {
      return s.all(...values);
    } finally {
      s.finalize();
    }
  }
  private run(sql: string, ...values: SqliteValue[]): void {
    const s = this.database.prepare(sql);
    try {
      s.run(...values);
    } finally {
      s.finalize();
    }
  }
  /**
   * The project each stored row holds, for every session `updateProject`
   * could move. A sweep over a whole session catalog consults this once
   * instead of opening a write transaction per candidate: SQLite takes a file
   * lock per transaction, so thousands of guaranteed-empty updates are
   * thousands of locks. A session absent here has nothing to move, and one
   * whose rows all hold the current project has nothing to change.
   */
  ownedProjects(): Map<string, Set<string>> {
    const owned = new Map<string, Set<string>>();
    for (const row of this.rows(
      "SELECT session_id,project_id FROM issue_index_jobs UNION SELECT session_id,project_id FROM session_issue_evidence",
    )) {
      const session = String(row.session_id);
      const projects = owned.get(session) ?? new Set<string>();
      projects.add(String(row.project_id));
      owned.set(session, projects);
    }
    return owned;
  }
  /**
   * What each queued session already holds, for the same reason
   * `ownedProjects` exists: re-admitting a catalog row that has not changed
   * would rewrite the row with its own values, and in recent scope that is one
   * autocommit upsert — one file lock — per recent session per catalog
   * publication. One read names the queue and the sweep writes only real
   * changes.
   */
  admittedJobs(): Map<string, AdmittedJob> {
    return new Map(
      this.rows(
        "SELECT session_id,project_id,priority,state,source_json FROM issue_index_jobs",
      ).map((row) => [
        String(row.session_id),
        {
          projectId: String(row.project_id),
          priority: Number(row.priority),
          state: String(row.state),
          source: String(row.source_json),
        },
      ]),
    );
  }
  updateProject(sessionId: string, projectId: string): void {
    this.database.transaction(() => {
      this.run(
        "UPDATE issue_index_jobs SET project_id=? WHERE session_id=? AND project_id!=?",
        projectId,
        sessionId,
        projectId,
      );
      this.run(
        "UPDATE session_issue_evidence SET project_id=? WHERE session_id=? AND project_id!=?",
        projectId,
        sessionId,
        projectId,
      );
    });
  }
  // The operational tables below are driven by the index worker and the
  // confirmation worker. They are named after what the caller is deciding, so
  // no column name, state string or upsert rule lives outside this file; the
  // workers own the policy, the store owns the statements.
  /** Return jobs a previous process left mid-acquisition to the queue. */
  requeueIndexing(): void {
    this.run(
      "UPDATE issue_index_jobs SET state='queued' WHERE state='indexing'",
    );
  }
  /**
   * Admit one catalog candidate. A changed source version or a paused job
   * returns to the queue; an already-running or finished job keeps its state.
   */
  admitJob(job: JobAdmission): void {
    this.run(
      `INSERT INTO issue_index_jobs(session_id,project_id,source_version,cursor,state,updated_at,source_json,priority)
      VALUES (?,?,?,NULL,'queued',?,?,?) ON CONFLICT(session_id) DO UPDATE SET
      state=CASE WHEN issue_index_jobs.source_version!=excluded.source_version OR issue_index_jobs.state='paused' THEN 'queued' ELSE issue_index_jobs.state END,
      project_id=excluded.project_id,source_json=excluded.source_json,source_version=excluded.source_version,priority=excluded.priority`,
      job.sessionId,
      job.projectId,
      job.sourceVersion,
      Date.now(),
      job.source,
      job.priority,
    );
  }
  /** Record a viewed window that was refused outright, without indexing it. */
  refuseViewedJob(sessionId: string, projectId: string, error: string): void {
    this.run(
      `INSERT INTO issue_index_jobs(session_id,project_id,source_version,state,error,updated_at,source_json,priority) VALUES (?,?,'','partial',?,?,'null',1)
       ON CONFLICT(session_id) DO UPDATE SET state=CASE WHEN issue_index_jobs.state='viewed' THEN 'partial' ELSE issue_index_jobs.state END`,
      sessionId,
      projectId,
      error,
      Date.now(),
    );
  }
  /** Record a viewed window whose observations have landed. */
  recordViewedJob(
    sessionId: string,
    projectId: string,
    state: "viewed" | "partial",
    error: string | null,
  ): void {
    this.run(
      `INSERT INTO issue_index_jobs(session_id,project_id,source_version,state,error,updated_at,source_json,priority) VALUES (?,?,'',?,?,?,'null',1)
      ON CONFLICT(session_id) DO UPDATE SET project_id=excluded.project_id,state=CASE WHEN excluded.state='partial' AND issue_index_jobs.state='viewed' THEN 'partial' ELSE issue_index_jobs.state END,error=COALESCE(excluded.error,issue_index_jobs.error)`,
      sessionId,
      projectId,
      state,
      error,
      Date.now(),
    );
  }
  /** One fair worker batch: viewed windows first, then least recently touched. */
  nextQueuedJobs(limit: number): QueuedJob[] {
    return this.rows(
      "SELECT session_id,source_version,cursor,source_json FROM issue_index_jobs WHERE state='queued' ORDER BY priority DESC,updated_at,session_id LIMIT ?",
      limit,
    ).map((row) => ({
      sessionId: String(row.session_id),
      sourceVersion: String(row.source_version),
      ...(typeof row.cursor === "string" ? { cursor: row.cursor } : {}),
      source: String(row.source_json),
    }));
  }
  /**
   * Move one job to a new state, leaving its cursor and acquisition time
   * alone. An `error` is supplied only when the new state carries a reason;
   * omitting it keeps whatever reason the row already holds.
   */
  markJob(sessionId: string, state: string, error?: string): void {
    if (error === undefined)
      this.run(
        "UPDATE issue_index_jobs SET state=? WHERE session_id=?",
        state,
        sessionId,
      );
    else
      this.run(
        "UPDATE issue_index_jobs SET state=?,error=? WHERE session_id=?",
        state,
        error,
        sessionId,
      );
  }
  /**
   * Record one acquisition batch against the source version it read. A job
   * whose source changed underneath it matches nothing and keeps the state its
   * re-admission gave it.
   */
  recordJobBatch(
    sessionId: string,
    sourceVersion: string,
    batch: { cursor: string; state: string; error: string | null },
  ): void {
    this.run(
      "UPDATE issue_index_jobs SET cursor=?,state=?,error=?,updated_at=? WHERE session_id=? AND source_version=?",
      batch.cursor,
      batch.state,
      batch.error,
      Date.now(),
      sessionId,
      sourceVersion,
    );
  }
  /** Fail one job against the source version it was reading. */
  failJob(sessionId: string, sourceVersion: string, error: string): void {
    this.run(
      "UPDATE issue_index_jobs SET state='failed',error=?,updated_at=? WHERE session_id=? AND source_version=?",
      error,
      Date.now(),
      sessionId,
      sourceVersion,
    );
  }
  /** Queue coverage for the settings page: how many jobs hold each state. */
  jobStateCounts(): { state: string; count: number }[] {
    return this.rows(
      "SELECT state,COUNT(*) AS count FROM issue_index_jobs GROUP BY state",
    ).map((row) => ({ state: String(row.state), count: Number(row.count) }));
  }
  /**
   * Queue one reference to be asked about again. A reference first seen while
   * confirmation was off holds no row, and the explicit request is what
   * authorizes its first lookup, so this writes the row when none exists.
   */
  requeueConfirmation(
    projectId: string,
    provider: string,
    refKey: string,
  ): void {
    this.run(
      `INSERT INTO issue_confirmations(project_id,provider,ref_key,state,checked_at) VALUES (?,?,?,'pending',0)
        ON CONFLICT(project_id,provider,ref_key) DO UPDATE SET state='pending'`,
      projectId,
      provider,
      refKey,
    );
  }
  /** References still awaiting their one query, oldest key first. */
  pendingConfirmations(limit: number): PendingConfirmation[] {
    return this.rows(
      "SELECT project_id,provider,ref_key FROM issue_confirmations WHERE state='pending' ORDER BY ref_key LIMIT ?",
      limit,
    ).map((row) => ({
      projectId: String(row.project_id),
      provider: String(row.provider),
      refKey: String(row.ref_key),
    }));
  }
  /** Store one tracker verdict, which stands until an explicit recheck. */
  recordConfirmation(
    reference: PendingConfirmation,
    verdict: { state: string; title?: string; detail?: string },
  ): void {
    this.run(
      "UPDATE issue_confirmations SET state=?,title=?,detail=?,checked_at=? WHERE project_id=? AND provider=? AND ref_key=?",
      verdict.state,
      verdict.title ?? null,
      verdict.detail ?? null,
      Date.now(),
      reference.projectId,
      reference.provider,
      reference.refKey,
    );
  }
  private link(issue: string, session: string): number {
    this.run(
      "INSERT OR IGNORE INTO session_issue_links(issue_id,session_id) VALUES (?,?)",
      issue,
      session,
    );
    return Number(
      this.rows(
        "SELECT id FROM session_issue_links WHERE issue_id=? AND session_id=?",
        issue,
        session,
      )[0]!.id,
    );
  }
  knownJiraProjects() {
    return this.rows(
      "SELECT DISTINCT prefix,site FROM jira_project_sites ORDER BY prefix,site",
    ).map((row) => ({ prefix: String(row.prefix), site: String(row.site) }));
  }
  private learnJira(url: string, project: string): void {
    const ref = issueUrl(url);
    if (ref?.provider !== "jira" || !ref.url) return;
    const prefix = ref.key.split("-")[0]!;
    const site = ref.url.slice(0, -`/browse/${ref.key}`.length);
    if (
      this.rows(
        "SELECT 1 FROM jira_project_sites WHERE prefix=? AND site=? AND project_id=?",
        prefix,
        site,
        project,
      ).length
    )
      return;
    this.run(
      "INSERT INTO jira_project_sites VALUES (?,?,?,?)",
      prefix,
      site,
      project,
      Date.now(),
    );
    this.reconcileJira();
  }
  /** Coalesce rule changes into one resumable pass; never scan provider files. */
  reconcileJira(): void {
    this.run(`INSERT INTO issue_registry_work(id,phase,after_id) VALUES (1,1,0)
      ON CONFLICT(id) DO UPDATE SET after_id=CASE WHEN phase=0 THEN after_id ELSE 0 END`);
  }
  private jiraIdentity(key: string, project: string): string | null {
    const prefix = key.split("-")[0]!;
    const blocked =
      this.settings().jiraKeyBlocklist ?? DEFAULT_JIRA_KEY_BLOCKLIST;
    if (blocked.some((name) => name === prefix)) return null;
    const sites = this.rows(
      "SELECT DISTINCT site FROM jira_project_sites WHERE prefix=? ORDER BY site",
      prefix,
    );
    const local =
      sites.length > 1
        ? this.rows(
            "SELECT DISTINCT site FROM jira_project_sites WHERE prefix=? AND project_id=? ORDER BY site",
            prefix,
            project,
          )
        : sites;
    if (local.length !== 1) return null;
    const ref = issueUrl(`${local[0]!.site}/browse/${key}`)!;
    this.run(
      `INSERT OR IGNORE INTO external_issues(id,ref_key,url,provider,kind,created_at) VALUES (?,?,?,'jira','issue',?)`,
      ref.identity!,
      key,
      ref.url!,
      Date.now(),
    );
    return ref.identity;
  }
  /** One bounded transaction per worker turn, including upgrade URL learning. */
  private processJiraRegistry(): boolean {
    const job = this.rows(
      "SELECT phase,after_id FROM issue_registry_work WHERE id=1",
    )[0];
    if (!job) return false;
    this.database.transaction(() => {
      const learning = job.phase === 0;
      const batch = this.rows(
        `SELECT e.*,l.state FROM session_issue_evidence e
        LEFT JOIN session_issue_links l ON l.id=e.link_id
        WHERE e.id>? AND e.provider='jira' AND ${learning ? "e.kind IN ('message-url','manual')" : "e.kind='ticket-key'"}
        ORDER BY e.id LIMIT 25`,
        job.after_id!,
      );
      for (const row of batch) {
        if (learning)
          this.learnJira(String(row.observed_value), String(row.project_id));
        else if (row.state !== "confirmed") {
          const identity = this.jiraIdentity(
            String(row.ref_key),
            String(row.project_id),
          );
          const link = identity
            ? this.link(identity, String(row.session_id))
            : null;
          this.run(
            "UPDATE session_issue_evidence SET link_id=?,suppressed=MAX(suppressed,?) WHERE id=?",
            link,
            row.state === "dismissed" ? 1 : 0,
            row.id!,
          );
        }
      }
      if (batch.length === 25)
        this.run(
          "UPDATE issue_registry_work SET after_id=? WHERE id=1",
          batch.at(-1)!.id!,
        );
      else if (learning)
        this.run(
          "UPDATE issue_registry_work SET phase=1,after_id=0 WHERE id=1",
        );
      else this.run("DELETE FROM issue_registry_work WHERE id=1");
    });
    return true;
  }
  /** Rules affect old observations immediately, including already linked keys. */
  private visibleEvidence(): string {
    const blocked =
      this.settings().jiraKeyBlocklist ?? DEFAULT_JIRA_KEY_BLOCKLIST;
    // Only normalized word-shaped project keys enter this literal list.
    const names = blocked
      .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name))
      .map((name) => `'${name}'`)
      .join(",");
    return `(e.provider!='jira' OR e.kind!='ticket-key' OR l.state='confirmed' OR
      (${names ? `substr(e.ref_key,1,instr(e.ref_key,'-')-1) NOT IN (${names}) AND` : ""}
      (e.link_id IS NOT NULL OR ${this.settings().aggressiveMatching ? 1 : 0}=1)))`;
  }
  /** At most 25 observations per transaction, including namespace learning. */
  capture(
    source: IssueSource,
    message: VisibleMessageText,
    offset = 0,
    ownedStart = offset,
    ownedEnd = Number.POSITIVE_INFINITY,
  ): void {
    this.captureText(source, message, offset, ownedStart, ownedEnd);
  }
  /**
   * Record the reference in a URL a user attached to a session by hand, with
   * their note as its excerpt. Its evidence kind is `manual`, which is what
   * makes it authoritative for namespace learning and identity resolution even
   * when the extractor would have read the same URL as an ordinary mention.
   *
   * The caller supplies the session and the URL; the message identity, the
   * evidence kind and the note's placement belong here, so a hand attachment
   * costs the same single insert as an extracted one.
   */
  captureManual(source: IssueSource, url: string, note: string): void {
    this.captureText(
      source,
      { id: `manual-${randomUUID()}`, text: url },
      0,
      0,
      Number.POSITIVE_INFINITY,
      note,
    );
  }
  private captureText(
    source: IssueSource,
    message: VisibleMessageText,
    offset: number,
    ownedStart: number,
    ownedEnd: number,
    /** Present for a hand-attached reference; its excerpt is the user's note. */
    manualNote?: string,
  ): void {
    const settings = this.settings();
    const refs = extractIssueReferences(message.text).filter(
      (ref) =>
        ref.start + offset >= ownedStart && ref.start + offset < ownedEnd,
    );
    for (let start = 0; start < refs.length; start += 25)
      this.database.transaction(() => {
        for (const ref of refs.slice(start, start + 25)) {
          if (
            source.sourceVersion &&
            this.rows(
              "SELECT 1 FROM issue_deleted_snapshots WHERE project_id=? AND ref_key=? AND session_id=? AND source_version=?",
              source.projectId,
              ref.key,
              source.sessionId,
              source.sourceVersion,
            ).length
          )
            continue;
          // Resolving a bare Jira key registers the identity it finds, so the
          // question is asked once per sighting and its answer reused, rather
          // than asked again from inside the confirmation test below.
          let identity =
            ref.identity ??
            (ref.provider === "jira"
              ? this.jiraIdentity(ref.key, source.projectId)
              : null);
          // A fresh sighting queues exactly one confirmation, and only while
          // confirmation is on, so turning it on never asks about a backlog.
          // OR IGNORE is the whole retry policy: a reference that already has
          // a verdict, even an unreachable one, is never asked about again.
          if (
            settings.confirmation?.enabled &&
            (identity ||
              ref.provider === "github" ||
              (!(settings.jiraKeyBlocklist ?? DEFAULT_JIRA_KEY_BLOCKLIST).some(
                (prefix) => prefix === ref.key.split("-")[0],
              ) &&
                settings.aggressiveMatching))
          )
            this.run(
              "INSERT OR IGNORE INTO issue_confirmations(project_id,provider,ref_key,state,checked_at) VALUES (?,?,?,'pending',0)",
              source.projectId,
              ref.provider,
              ref.key,
            );
          if (ref.identity) {
            if (ref.provider === "jira" && ref.url)
              this.learnJira(ref.url, source.projectId);
            this.run(
              `INSERT INTO external_issues(id,ref_key,url,provider,kind,title,created_at) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET kind=CASE WHEN external_issues.kind='pr' THEN 'pr' ELSE excluded.kind END,url=CASE WHEN external_issues.kind='pr' THEN external_issues.url ELSE excluded.url END,title=COALESCE(external_issues.title,excluded.title)`,
              identity,
              ref.key,
              ref.url,
              ref.provider,
              ref.kind,
              ref.title,
              Date.now(),
            );
          } else if (ref.provider !== "jira") {
            // Only observations in this project establish a namespace mapping.
            const matches = this.rows(
              `SELECT DISTINCT i.id FROM external_issues i JOIN session_issue_links l ON l.issue_id=i.id
            JOIN session_issue_evidence e ON e.link_id=l.id WHERE e.project_id=? AND i.ref_key=? AND e.kind IN ('message-url','manual','contextual-number') LIMIT 2`,
              source.projectId,
              ref.key,
            );
            if (matches.length === 1) identity = String(matches[0]!.id);
          }
          const link = identity ? this.link(identity, source.sessionId) : null;
          const occurrence = createHash("sha256")
            .update(
              JSON.stringify([
                message.sourceId ?? message.id,
                offset + ref.start,
                ref.key,
              ]),
            )
            .digest("hex");
          // The stored version names the rules that produced this row's
          // reference and excerpt, so a redelivery keeps the original: the
          // conflict branch updates identity and location, not the text.
          this.run(
            `INSERT INTO session_issue_evidence(session_id,project_id,occurrence,ref_key,provider,link_id,kind,observed_value,excerpt,message_id,observed_at,source_time,extractor_version)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,occurrence) DO UPDATE SET
          link_id=COALESCE(session_issue_evidence.link_id,excluded.link_id), project_id=excluded.project_id`,
            source.sessionId,
            source.projectId,
            occurrence,
            ref.key,
            ref.provider,
            link,
            manualNote !== undefined
              ? "manual"
              : ref.contextual
                ? "contextual-number"
                : ref.url
                  ? "message-url"
                  : "ticket-key",
            ref.contextual
              ? message.text.slice(ref.start, ref.end)
              : (ref.url ?? ref.key),
            manualNote !== undefined
              ? manualNote
              : issueExcerpt(
                  message.text.slice(
                    Math.max(0, ref.start - 140),
                    Math.max(0, ref.start - 140) + 512,
                  ),
                ),
            message.id,
            Date.now(),
            message.timestamp ?? null,
            EXTRACTOR_VERSION,
          );
          if (identity)
            this.run(
              "INSERT OR IGNORE INTO issue_resolution_jobs VALUES (?,?)",
              source.projectId,
              ref.key,
            );
        }
      });
    this.processResolutions();
  }
  /** A bounded resolution batch; the index worker resumes remaining durable jobs. */
  processResolutions(): boolean {
    if (this.processJiraRegistry()) return true;
    const job = this.rows("SELECT * FROM issue_resolution_jobs LIMIT 1")[0];
    if (!job) return false;
    this.database.transaction(() => {
      const project = String(job.project_id),
        key = String(job.ref_key);
      if (!key.includes("#")) {
        this.run(
          "DELETE FROM issue_resolution_jobs WHERE project_id=? AND ref_key=?",
          project,
          key,
        );
        return;
      }
      const candidates = this.rows(
        `SELECT DISTINCT i.id FROM external_issues i JOIN session_issue_links l ON l.issue_id=i.id JOIN session_issue_evidence e ON e.link_id=l.id WHERE e.project_id=? AND i.ref_key=? AND e.kind IN ('message-url','manual','contextual-number') LIMIT 2`,
        project,
        key,
      );
      let pending: SqliteRow[] = [];
      if (candidates.length === 1) {
        const id = String(candidates[0]!.id);
        pending = this.rows(
          "SELECT id,session_id FROM session_issue_evidence WHERE project_id=? AND ref_key=? AND link_id IS NULL LIMIT 25",
          project,
          key,
        );
        for (const evidence of pending)
          this.run(
            "UPDATE session_issue_evidence SET link_id=? WHERE id=?",
            this.link(id, String(evidence.session_id)),
            evidence.id!,
          );
      } else if (candidates.length > 1) {
        pending = this.rows(
          `SELECT e.id,l.state FROM session_issue_evidence e JOIN session_issue_links l ON l.id=e.link_id WHERE e.project_id=? AND e.ref_key=? AND e.kind='ticket-key' AND l.state!='confirmed' LIMIT 25`,
          project,
          key,
        );
        for (const evidence of pending)
          this.run(
            "UPDATE session_issue_evidence SET suppressed=MAX(suppressed,?),link_id=NULL WHERE id=?",
            evidence.state === "dismissed" ? 1 : 0,
            evidence.id!,
          );
      }
      if (pending.length < 25)
        this.run(
          "DELETE FROM issue_resolution_jobs WHERE project_id=? AND ref_key=?",
          project,
          key,
        );
    });
    return true;
  }
  list(
    query = "",
    project = "",
    session = "",
    dismissed = false,
    limit = 50,
    offset = 0,
    options: {
      sort?: IssueSort | "key";
      sessionActivity?: readonly { sessionId: string; updatedAt: string }[];
    } = {},
  ): IssueItem[] {
    // Only these fixed clauses enter SQL. Sort the complete filtered aggregate
    // before LIMIT; the catalog snapshot needs no transcript reads or DB writes.
    const order = {
      key: "ref_key",
      activity: "last_activity DESC",
      mentioned: "last_mention DESC",
      number: `provider, substr(ref_key,1,number_start-1),
        length(substr(ref_key,number_start)), substr(ref_key,number_start)`,
    }[options.sort ?? "key"];
    const isoTime = (day: SqliteValue | undefined): string | null =>
      typeof day === "number"
        ? new Date(Math.round((day - 2440587.5) * 86400000)).toISOString()
        : null;
    const rows = this.rows(
      `WITH activity AS MATERIALIZED (
      -- Match the evidence column's TEXT affinity so SQLite can index this join.
      SELECT CAST(json_extract(value,'$.sessionId') AS TEXT) AS session_id,
        julianday(json_extract(value,'$.updatedAt')) AS activity
      FROM json_each(?)
    ), observations AS (
      SELECT e.*,l.issue_id,l.state,COALESCE(j.project_id,e.project_id) AS current_project,a.activity
      FROM session_issue_evidence e LEFT JOIN session_issue_links l ON l.id=e.link_id LEFT JOIN issue_index_jobs j ON j.session_id=e.session_id
      LEFT JOIN activity a ON a.session_id=e.session_id
      WHERE ${this.visibleEvidence()} AND (?=1 OR (e.suppressed=0 AND COALESCE(l.state,'discovered')!='dismissed'))
      AND (?='' OR COALESCE(j.project_id,e.project_id)=?) AND (?='' OR e.session_id=?)
    ), items AS (
      SELECT i.id,i.ref_key,COALESCE(i.manual_title,i.title) AS title,i.url,i.provider,i.kind,COUNT(DISTINCT e.session_id) AS count,NULL AS context,MAX(e.activity) AS last_activity,MAX(julianday(e.source_time)) AS last_mention
      FROM external_issues i JOIN observations e ON e.issue_id=i.id GROUP BY i.id
      UNION ALL
      SELECT NULL,ref_key,NULL,NULL,provider,'unknown',COUNT(DISTINCT session_id),current_project,MAX(activity),MAX(julianday(source_time)) FROM observations WHERE link_id IS NULL GROUP BY current_project,provider,ref_key
    ), numbered AS (
      SELECT *,CASE WHEN provider='github' THEN instr(ref_key,'#')+1 ELSE instr(ref_key,'-')+1 END AS number_start FROM items
    ) SELECT items.*,
      -- The most decisive verdict for this reference: one project confirming
      -- it settles the key even when another only recorded an outage.
      (SELECT c.state FROM issue_confirmations c WHERE c.ref_key=items.ref_key
        ORDER BY CASE c.state WHEN 'confirmed' THEN 0 WHEN 'rejected' THEN 1 WHEN 'unreachable' THEN 2 ELSE 3 END LIMIT 1) AS confirm_state,
      (SELECT c.title FROM issue_confirmations c WHERE c.ref_key=items.ref_key AND c.state='confirmed' AND c.title IS NOT NULL LIMIT 1) AS confirm_title
      FROM numbered items WHERE ref_key LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' ORDER BY ${order},ref_key,context,id LIMIT ? OFFSET ?`,
      JSON.stringify(
        (options.sessionActivity ?? []).map(({ sessionId, updatedAt }) => ({
          sessionId,
          updatedAt,
        })),
      ),
      dismissed ? 1 : 0,
      project,
      project,
      session,
      session,
      escaped(query),
      escaped(query),
      escaped(query),
      limit,
      offset,
    );
    return rows.map((row) => ({
      id: row.id
        ? String(row.id)
        : unresolvedId(String(row.context), String(row.ref_key)),
      key: String(row.ref_key),
      title: row.title as string | null,
      url: row.url as string | null,
      provider: String(row.provider),
      kind: String(row.kind),
      sessionCount: Number(row.count),
      lastSessionActivityAt: isoTime(row.last_activity),
      lastMentionAt: isoTime(row.last_mention),
      unresolved: row.id === null,
      ...(row.confirm_state
        ? {
            confirmation: {
              state: String(row.confirm_state) as NonNullable<
                IssueItem["confirmation"]
              >["state"],
              title: (row.confirm_title as string | null) ?? null,
            },
          }
        : {}),
    }));
  }
  private selector(id: string): { sql: string; values: SqliteValue[] } {
    if (!id.startsWith("ref:")) return { sql: "l.issue_id=?", values: [id] };
    const parsed: unknown = JSON.parse(id.slice(4));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed.some((x) => typeof x !== "string")
    )
      throw new Error("Invalid reference");
    return {
      sql: "e.link_id IS NULL AND COALESCE(j.project_id,e.project_id)=? AND e.ref_key=?",
      values: parsed,
    };
  }
  evidence(
    id: string,
    limit = 50,
    offset = 0,
    session = "",
    dismissed = true,
  ): IssueEvidence[] {
    const match = this.selector(id);
    return this.rows(
      `SELECT e.*,COALESCE(j.project_id,e.project_id) AS current_project,CASE WHEN e.suppressed=1 THEN 'dismissed' ELSE COALESCE(l.state,'discovered') END AS state FROM session_issue_evidence e LEFT JOIN session_issue_links l ON l.id=e.link_id LEFT JOIN issue_index_jobs j ON j.session_id=e.session_id WHERE ${match.sql} AND ${this.visibleEvidence()} AND (?='' OR e.session_id=?) AND (?=1 OR (e.suppressed=0 AND COALESCE(l.state,'discovered')!='dismissed')) ORDER BY CASE WHEN julianday(e.source_time) IS NULL THEN 1 ELSE 0 END,julianday(e.source_time),e.id LIMIT ? OFFSET ?`,
      ...match.values,
      session,
      session,
      dismissed ? 1 : 0,
      limit,
      offset,
    ).map((row) => ({
      id: Number(row.id),
      sessionId: String(row.session_id),
      projectId: String(row.current_project),
      messageId: String(row.message_id),
      excerpt: String(row.excerpt),
      value: String(row.observed_value),
      kind: String(row.kind),
      observedAt: Number(row.observed_at),
      sourceTime: row.source_time as string | null,
      state: String(row.state),
    }));
  }
  sessions(id: string, dismissed = false) {
    const match = this.selector(id);
    return this.rows(
      `SELECT e.session_id,COALESCE(j.project_id,e.project_id) AS project_id,
      COUNT(*) AS count, MIN(CASE WHEN e.suppressed=1 THEN 'dismissed' ELSE COALESCE(l.state,'discovered') END) AS state,
      MAX(e.source_time) AS last_mention
      FROM session_issue_evidence e LEFT JOIN session_issue_links l ON l.id=e.link_id
      LEFT JOIN issue_index_jobs j ON j.session_id=e.session_id
      WHERE ${match.sql} AND ${this.visibleEvidence()}
      AND (?=1 OR (e.suppressed=0 AND COALESCE(l.state,'discovered')!='dismissed'))
      GROUP BY e.session_id`,
      ...match.values,
      dismissed ? 1 : 0,
    ).map((row) => ({
      sessionId: String(row.session_id),
      projectId: String(row.project_id),
      evidenceCount: Number(row.count),
      state: String(row.state),
      lastMention: row.last_mention as string | null,
    }));
  }
  decide(
    id: string,
    session: string,
    state: "confirmed" | "dismissed" | "discovered",
  ): void {
    this.database.transaction(() => {
      if (!id.startsWith("ref:")) {
        this.run(
          "UPDATE session_issue_links SET state=?,decision_at=? WHERE issue_id=? AND session_id=?",
          state,
          Date.now(),
          id,
          session,
        );
        if (state !== "dismissed")
          this.run(
            "UPDATE session_issue_evidence SET suppressed=0 WHERE link_id IN (SELECT id FROM session_issue_links WHERE issue_id=? AND session_id=?)",
            id,
            session,
          );
      } else {
        const match = this.selector(id);
        this.run(
          `UPDATE session_issue_evidence SET suppressed=? WHERE id IN (SELECT e.id FROM session_issue_evidence e LEFT JOIN session_issue_links l ON l.id=e.link_id LEFT JOIN issue_index_jobs j ON j.session_id=e.session_id WHERE ${match.sql} AND e.session_id=?)`,
          state === "dismissed" ? 1 : 0,
          ...match.values,
          session,
        );
      }
    });
  }
  title(id: string, title: string | null): string | null {
    this.run("UPDATE external_issues SET manual_title=? WHERE id=?", title, id);
    return (
      (this.rows(
        "SELECT COALESCE(manual_title,title) AS title FROM external_issues WHERE id=?",
        id,
      )[0]?.title as string | null) ?? null
    );
  }
  delete(id: string): void {
    const match = this.selector(id);
    this.database.transaction(() => {
      this.run(
        `INSERT OR IGNORE INTO issue_deleted_snapshots SELECT COALESCE(j.project_id,e.project_id),e.ref_key,e.session_id,j.source_version FROM session_issue_evidence e LEFT JOIN session_issue_links l ON l.id=e.link_id JOIN issue_index_jobs j ON j.session_id=e.session_id WHERE ${match.sql}`,
        ...match.values,
      );
      if (!id.startsWith("ref:"))
        this.run("DELETE FROM external_issues WHERE id=?", id);
      else
        this.run(
          `DELETE FROM session_issue_evidence WHERE id IN (SELECT e.id FROM session_issue_evidence e LEFT JOIN session_issue_links l ON l.id=e.link_id LEFT JOIN issue_index_jobs j ON j.session_id=e.session_id WHERE ${match.sql})`,
          ...match.values,
        );
    });
  }
  remap(oldId: string, newId: string): void {
    this.database.transaction(() => {
      for (const link of this.rows(
        "SELECT * FROM session_issue_links WHERE session_id=?",
        oldId,
      )) {
        const target = this.link(String(link.issue_id), newId);
        this.run(
          `UPDATE session_issue_links SET state=?,decision_at=? WHERE id=? AND (decision_at<? OR (decision_at=? AND ?='dismissed'))`,
          link.state!,
          link.decision_at!,
          target,
          link.decision_at!,
          link.decision_at!,
          link.state!,
        );
        this.run(
          "UPDATE session_issue_evidence SET link_id=? WHERE link_id=?",
          target,
          link.id!,
        );
      }
      this.run(
        "UPDATE session_issue_evidence SET suppressed=1 WHERE session_id=? AND occurrence IN (SELECT occurrence FROM session_issue_evidence WHERE session_id=? AND suppressed=1)",
        newId,
        oldId,
      );
      this.run(
        "DELETE FROM session_issue_evidence WHERE session_id=? AND occurrence IN (SELECT occurrence FROM session_issue_evidence WHERE session_id=?)",
        oldId,
        newId,
      );
      this.run(
        "UPDATE session_issue_evidence SET session_id=? WHERE session_id=?",
        newId,
        oldId,
      );
      this.run("DELETE FROM session_issue_links WHERE session_id=?", oldId);
      this.run(
        "INSERT OR IGNORE INTO issue_deleted_snapshots SELECT project_id,ref_key,?,source_version FROM issue_deleted_snapshots WHERE session_id=?",
        newId,
        oldId,
      );
      this.run("DELETE FROM issue_deleted_snapshots WHERE session_id=?", oldId);
      this.run("DELETE FROM issue_index_jobs WHERE session_id=?", oldId);
    });
  }
}
