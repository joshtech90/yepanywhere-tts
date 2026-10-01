import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Whether another program's Claude Code process is busy with a session.
 *
 * Claude Code keeps one `<pid>.json` per running process in
 * `<CLAUDE_CONFIG_DIR>/sessions` with its session id and a busy/idle status.
 * During a long tool call the transcript stays silent, so this file is the
 * only evidence that an external turn is still running. A busy file whose
 * process has exited is stale and does not count.
 *
 * Read lazily and at most once per `maxAgeMs`; nothing here runs on a timer.
 */
export interface PeerStatusSource {
  isBusy(sessionId: string): Promise<boolean>;
}

interface PeerEntry {
  pid: number;
  status: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class ClaudePeerStatus implements PeerStatusSource {
  private entries = new Map<string, PeerEntry>();
  private readAt = Number.NEGATIVE_INFINITY;
  private reading: Promise<void> | null = null;

  constructor(
    private readonly dir: string,
    private readonly options: {
      maxAgeMs?: number;
      now?: () => number;
      isAlive?: (pid: number) => boolean;
    } = {},
  ) {}

  async isBusy(sessionId: string): Promise<boolean> {
    await this.refresh();
    const entry = this.entries.get(sessionId);
    if (entry?.status !== "busy") return false;
    return (this.options.isAlive ?? pidAlive)(entry.pid);
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
    const next = new Map<string, PeerEntry>();
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      this.entries = next;
      return;
    }
    await Promise.all(
      names
        .filter((name) => /^\d+\.json$/.test(name))
        .map(async (name) => {
          try {
            const parsed = JSON.parse(
              await readFile(path.join(this.dir, name), "utf8"),
            ) as { pid?: unknown; sessionId?: unknown; status?: unknown };
            if (
              typeof parsed.pid === "number" &&
              typeof parsed.sessionId === "string" &&
              typeof parsed.status === "string"
            ) {
              // Two processes on one session: a busy one wins.
              if (next.get(parsed.sessionId)?.status === "busy") return;
              next.set(parsed.sessionId, {
                pid: parsed.pid,
                status: parsed.status,
              });
            }
          } catch {
            // A file mid-write or of an unknown shape says nothing.
          }
        }),
    );
    this.entries = next;
  }
}
