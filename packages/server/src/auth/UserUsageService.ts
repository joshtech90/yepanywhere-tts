/**
 * UserUsageService records what each principal did, so Settings → Users can
 * report per-user usage without reading a single provider transcript.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage.
 *
 * The store is an append-only JSONL ledger, one short line per session start,
 * per user turn, and per settled provider turn's token charge. Appending is
 * the only write, so a turn costs one small append and never a rewrite;
 * reporting reads the file once. A record's
 * absent username means the superuser, which is also what every action taken
 * before this existed means — so the ledger starts empty and the report says
 * how far back it actually reaches rather than implying it covers all time.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  type UsageEvent,
  type UsageReport,
  countWords,
  summarizeUsage,
} from "@yep-anywhere/shared";
import {
  OWNER_READ_WRITE_FILE_MODE,
  enforceOwnerReadWriteFilePermissions,
} from "../utils/filePermissions.js";

/**
 * Cap the ledger so an install that runs for years cannot grow it without
 * bound. At roughly 60 bytes a line this is a few megabytes, and trimming
 * keeps the newest records: a report's window shrinks rather than its recent
 * numbers going wrong. The file may run `TRIM_SLACK` records over the cap
 * before a trim, so a trim rewrites the file once per `TRIM_SLACK` appends
 * rather than on every one.
 */
export const MAX_LEDGER_EVENTS = 50_000;
export const TRIM_SLACK = 1_000;

export interface UserUsageServiceOptions {
  dataDir: string;
  /** Injectable for tests. */
  now?: () => number;
}

export class UserUsageService {
  private readonly filePath: string;
  private readonly now: () => number;
  /**
   * Serializes writes so two turns cannot interleave a partial line. It never
   * holds a rejection: each write's failure belongs to that write alone, so
   * one failed append cannot stop every later one.
   */
  private writeChain: Promise<void> = Promise.resolve();
  /**
   * Records in the file, counted from the file itself on this process's first
   * write rather than from zero, so the cap holds on a host restarted more
   * often than a trim would otherwise come due. Undefined until then, and
   * again after a failed write leaves the count uncertain.
   */
  private ledgerRecords: number | undefined;

  constructor(options: UserUsageServiceOptions) {
    this.filePath = path.join(options.dataDir, "user-usage.jsonl");
    this.now = options.now ?? Date.now;
  }

  /** Record that a principal started a session. */
  recordSession(username: string | undefined): Promise<void> {
    return this.append({
      t: this.now(),
      k: "session",
      ...(username ? { u: username } : {}),
    });
  }

  /** Record a user turn and the words it carried. */
  recordTurn(username: string | undefined, text: string): Promise<void> {
    const words = countWords(text);
    return this.append({
      t: this.now(),
      k: "turn",
      ...(username ? { u: username } : {}),
      ...(words > 0 ? { w: words } : {}),
    });
  }

  /**
   * Record tokens a provider charged for one principal's work, by class and
   * named by model short name, project, provider and context tier — the four
   * things the price of those tokens depends on. Nothing is appended for a
   * zero charge, so an idling session adds no lines.
   */
  recordTokens(record: {
    username?: string;
    /** Launch alias, e.g. `opus`; absent when the process never reported one. */
    model?: string;
    /** Resolved provider model id, which the price table is keyed by. */
    modelId?: string;
    project?: string;
    /** Which price list the counts are read under. */
    provider?: string;
    /** Whether these requests were in the provider's long-context tier. */
    longContext?: boolean;
    freshInputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  }): Promise<void> {
    const count = (value: number) => Math.max(0, Math.floor(value));
    const fresh = count(record.freshInputTokens);
    const cached = count(record.cachedInputTokens);
    const written = count(record.cacheWriteTokens);
    const output = count(record.outputTokens);
    if (fresh === 0 && cached === 0 && written === 0 && output === 0) {
      return Promise.resolve();
    }
    return this.append({
      t: this.now(),
      k: "tokens",
      ...(record.username ? { u: record.username } : {}),
      ...(record.model ? { m: record.model } : {}),
      ...(record.modelId ? { d: record.modelId } : {}),
      ...(record.project ? { p: record.project } : {}),
      ...(record.provider ? { v: record.provider } : {}),
      ...(record.longContext ? { x: 1 as const } : {}),
      ...(fresh > 0 ? { i: fresh } : {}),
      ...(cached > 0 ? { r: cached } : {}),
      ...(written > 0 ? { c: written } : {}),
      ...(output > 0 ? { o: output } : {}),
    });
  }

  /** Usage per principal, seeded so a user who has done nothing still shows. */
  async report(knownUsernames: readonly string[] = []): Promise<UsageReport> {
    // Includes every record accepted before the report was asked for, even
    // one a fire-and-forget caller is still appending.
    await this.writeChain;
    const events = await this.readEvents();
    return summarizeUsage(events, { now: this.now(), knownUsernames });
  }

  /**
   * Drop every record for a user, so deleting them takes their history too.
   * Rejects only if this rewrite itself fails, never for an earlier append.
   */
  forgetUser(username: string): Promise<void> {
    return this.serialize(async () => {
      const events = await this.readEvents();
      const kept = events.filter((event) => event.u !== username);
      this.ledgerRecords = events.length;
      if (kept.length === events.length) return;
      await this.rewrite(kept);
    });
  }

  /**
   * Run one write after every earlier one has settled, whether it succeeded
   * or not, and hand its own outcome to the caller alone.
   */
  private serialize(write: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(write);
    this.writeChain = run.catch(() => {
      // A failed count is re-read from the file by the next write.
      this.ledgerRecords = undefined;
    });
    return run;
  }

  /**
   * Append one record. Callers fire and forget on the turn path, so this
   * resolves either way: a failed append is logged and costs that record.
   */
  private append(event: UsageEvent): Promise<void> {
    return this.serialize(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      this.ledgerRecords ??= (await this.readEvents()).length;
      await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, {
        mode: OWNER_READ_WRITE_FILE_MODE,
      });
      await enforceOwnerReadWriteFilePermissions(this.filePath, "[UserUsage]");
      this.ledgerRecords += 1;
      if (this.ledgerRecords > MAX_LEDGER_EVENTS + TRIM_SLACK) {
        await this.trimToCap();
      }
    }).catch((error: unknown) => {
      console.warn("[UserUsage] Usage ledger append failed:", error);
    });
  }

  private async readEvents(): Promise<UsageEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf-8");
    } catch {
      return [];
    }
    const events: UsageEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line === "") continue;
      try {
        const parsed = JSON.parse(line) as UsageEvent;
        // A truncated tail from an interrupted append is dropped, not fatal.
        if (typeof parsed?.t !== "number") continue;
        if (
          parsed.k !== "session" &&
          parsed.k !== "turn" &&
          parsed.k !== "tokens"
        ) {
          continue;
        }
        events.push(parsed);
      } catch {
        // Same: an unparseable line costs its own record and nothing else.
      }
    }
    return events;
  }

  private async trimToCap(): Promise<void> {
    const events = await this.readEvents();
    this.ledgerRecords = events.length;
    if (events.length <= MAX_LEDGER_EVENTS) return;
    await this.rewrite(events.slice(events.length - MAX_LEDGER_EVENTS));
  }

  private async rewrite(events: readonly UsageEvent[]): Promise<void> {
    const body = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, body, { mode: OWNER_READ_WRITE_FILE_MODE });
    await fs.rename(temporary, this.filePath);
    this.ledgerRecords = events.length;
    await enforceOwnerReadWriteFilePermissions(this.filePath, "[UserUsage]");
  }
}
