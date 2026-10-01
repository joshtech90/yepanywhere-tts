import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Whether another program's Claude Code process is busy with a session.
 *
 * Claude Code keeps one `<pid>.json` per running process in
 * `<CLAUDE_CONFIG_DIR>/sessions` with its session id, a busy/idle status, and
 * the process start time. During a long tool call the transcript stays
 * silent, so this file is the only evidence that an external turn is still
 * running. A file only counts while its process is alive and is the same
 * process (start time matches), so a stale file never keeps a session busy
 * through a reused pid.
 *
 * Read lazily and at most once per `maxAgeMs`; nothing here runs on a timer.
 */
export interface PeerStatusSource {
  isBusy(sessionId: string): Promise<boolean>;
}

interface PeerEntry {
  pid: number;
  status: string;
  procStart?: string;
  pidDomain?: string;
}

/** Bounds per refresh: a directory full of stale files stays cheap. */
const MAX_FILES = 200;
const MAX_FILE_BYTES = 64 * 1024;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Start time as `ps -o lstart=` prints it in UTC, the format Claude stores. */
function processStart(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-o", "lstart=", "-p", String(pid)],
      { env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, timeout: 2000 },
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    );
  });
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

export class ClaudePeerStatus implements PeerStatusSource {
  private entries = new Map<string, PeerEntry[]>();
  private readAt = Number.NEGATIVE_INFINITY;
  private reading: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly options: {
      maxAgeMs?: number;
      now?: () => number;
      isAlive?: (pid: number) => boolean;
      startOf?: (pid: number) => Promise<string | null>;
    } = {},
  ) {}

  async isBusy(sessionId: string): Promise<boolean> {
    await this.refresh();
    for (const entry of this.entries.get(sessionId) ?? []) {
      if (entry.status === "busy" && (await this.isSameProcess(entry))) {
        return true;
      }
    }
    return false;
  }

  private async isSameProcess(entry: PeerEntry): Promise<boolean> {
    if (entry.pidDomain && entry.pidDomain !== process.platform) return false;
    if (!(this.options.isAlive ?? pidAlive)(entry.pid)) return false;
    // Without a recorded start time the pid alone cannot prove identity.
    if (!entry.procStart) return false;
    const started = await (this.options.startOf ?? processStart)(entry.pid);
    return (
      started !== null && normalize(started) === normalize(entry.procStart)
    );
  }

  private async refresh(): Promise<void> {
    const now = (this.options.now ?? Date.now)();
    if (now - this.readAt < (this.options.maxAgeMs ?? 2000)) return;
    if (!this.reading) {
      this.reading = this.read().finally(() => {
        this.readAt = (this.options.now ?? Date.now)();
        this.reading = null;
      });
    }
    await this.reading;
  }

  private async read(): Promise<void> {
    const next = new Map<string, PeerEntry[]>();
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      this.entries = next;
      return;
    }
    const isAlive = this.options.isAlive ?? pidAlive;
    // Only files of living processes are read, one at a time and capped.
    const candidates = names
      .map((name) => /^(\d+)\.json$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ name: match[0], pid: Number(match[1]) }))
      .filter(({ pid }) => Number.isSafeInteger(pid) && pid > 0 && isAlive(pid))
      .slice(0, MAX_FILES);
    for (const { name, pid } of candidates) {
      try {
        const file = path.join(this.dir, name);
        if ((await stat(file)).size > MAX_FILE_BYTES) continue;
        const parsed = JSON.parse(await readFile(file, "utf8")) as Record<
          string,
          unknown
        >;
        if (
          parsed.pid !== pid ||
          typeof parsed.sessionId !== "string" ||
          typeof parsed.status !== "string"
        ) {
          continue;
        }
        const list = next.get(parsed.sessionId) ?? [];
        list.push({
          pid,
          status: parsed.status,
          procStart:
            typeof parsed.procStart === "string" ? parsed.procStart : undefined,
          pidDomain:
            typeof parsed.pidDomain === "string" ? parsed.pidDomain : undefined,
        });
        next.set(parsed.sessionId, list);
      } catch {
        // A file mid-write or of an unknown shape says nothing.
      }
    }
    this.entries = next;
  }
}
