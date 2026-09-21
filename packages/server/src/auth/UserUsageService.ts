/**
 * UserUsageService records what each principal did, so Settings → Users can
 * report per-user usage without reading a single provider transcript.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage.
 *
 * The store is an append-only JSONL ledger, one short line per session start
 * and per user turn. Appending is the only write, so a turn costs one small
 * append and never a rewrite; reporting reads the file once. A record's
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
 * numbers going wrong.
 */
const MAX_LEDGER_EVENTS = 50_000;
const TRIM_CHECK_INTERVAL = 1_000;

export interface UserUsageServiceOptions {
  dataDir: string;
  /** Injectable for tests. */
  now?: () => number;
}

export class UserUsageService {
  private readonly filePath: string;
  private readonly now: () => number;
  /** Serializes appends so two turns cannot interleave a partial line. */
  private writeChain: Promise<void> = Promise.resolve();
  private appendsSinceTrimCheck = 0;

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

  /** Usage per principal, seeded so a user who has done nothing still shows. */
  async report(knownUsernames: readonly string[] = []): Promise<UsageReport> {
    const events = await this.readEvents();
    return summarizeUsage(events, { now: this.now(), knownUsernames });
  }

  /** Drop every record for a user, so deleting them takes their history too. */
  async forgetUser(username: string): Promise<void> {
    await this.writeChain;
    this.writeChain = this.writeChain.then(async () => {
      const events = await this.readEvents();
      const kept = events.filter((event) => event.u !== username);
      if (kept.length === events.length) return;
      await this.rewrite(kept);
    });
    await this.writeChain;
  }

  private append(event: UsageEvent): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, {
        mode: OWNER_READ_WRITE_FILE_MODE,
      });
      await enforceOwnerReadWriteFilePermissions(this.filePath, "[UserUsage]");
      this.appendsSinceTrimCheck += 1;
      if (this.appendsSinceTrimCheck >= TRIM_CHECK_INTERVAL) {
        this.appendsSinceTrimCheck = 0;
        await this.trimIfOversized();
      }
    });
    return this.writeChain;
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
        if (parsed.k !== "session" && parsed.k !== "turn") continue;
        events.push(parsed);
      } catch {
        // Same: an unparseable line costs its own record and nothing else.
      }
    }
    return events;
  }

  private async trimIfOversized(): Promise<void> {
    const events = await this.readEvents();
    if (events.length <= MAX_LEDGER_EVENTS) return;
    await this.rewrite(events.slice(events.length - MAX_LEDGER_EVENTS));
  }

  private async rewrite(events: readonly UsageEvent[]): Promise<void> {
    const body = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, body, { mode: OWNER_READ_WRITE_FILE_MODE });
    await fs.rename(temporary, this.filePath);
    await enforceOwnerReadWriteFilePermissions(this.filePath, "[UserUsage]");
  }
}
