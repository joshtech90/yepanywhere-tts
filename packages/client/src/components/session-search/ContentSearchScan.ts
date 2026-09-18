import {
  getCollapsedSearchPreviewText,
  normalizeSearchPreviewText,
  type SessionContentMatch,
  type SessionContentDiagnostic,
  type SessionContentSearchBatch,
} from "@yep-anywhere/shared";
import type { SourceTransport } from "../../lib/transport";

export interface SessionScan {
  revision: string;
  matches: SessionContentMatch[];
  partial?: string;
  done: boolean;
  cursor?: string;
  resumeCursor?: string;
  tailing?: boolean;
  found: Map<string, SessionContentMatch>;
  diagnostics: SessionContentDiagnostic[];
  foundDiagnostics: Map<string, SessionContentDiagnostic>;
  workPartial?: string;
  retries: number;
  started: boolean;
  acquisitionQuery: string;
  retainedBytes: number;
  refinable: boolean;
  limited: boolean;
  seed?: SessionScan;
}

export const MIN_TURN_SEARCH_QUERY_LENGTH = 1;
export const MAX_CACHED_MATCHES_PER_SESSION = 1024;
export const MAX_CACHED_SEARCH_TEXT_BYTES_PER_SESSION = 2 * 1024 * 1024;
export const MAX_CACHED_SEARCH_TEXT_BYTES_PER_SCAN = 32 * 1024 * 1024;

export function refineMatch(match: SessionContentMatch, query: string) {
  if (match.searchText === undefined) return undefined;
  const text = normalizeSearchPreviewText(match.searchText)
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!text.includes(query.replace(/\s+/g, " ").trim().toLowerCase()))
    return undefined;
  return {
    ...match,
    preview: getCollapsedSearchPreviewText(match.searchText, query),
  };
}

/** One page's shared request budget, round-robin across both query generations. */
export class ContentSearchPool {
  private active = 0;
  private waiting = new Map<object, () => Promise<void> | undefined>();

  constructor(private readonly limit = 4) {}

  add(owner: object, next: () => Promise<void> | undefined) {
    this.waiting.set(owner, next);
    this.pump();
  }

  remove(owner: object) {
    this.waiting.delete(owner);
  }

  private pump() {
    while (this.active < this.limit && this.waiting.size) {
      const [owner, next] = this.waiting.entries().next().value!;
      this.waiting.delete(owner);
      this.active++;
      const task = next();
      if (!task) {
        this.active--;
        continue;
      }
      this.waiting.set(owner, next);
      void task.finally(() => {
        this.active--;
        this.pump();
      });
    }
  }
}

function waitForCapacity(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, 1000);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** One query generation. Fair, bounded reads; catalog updates repair only changed rows. */
export class ContentSearchScan {
  readonly entries = new Map<string, SessionScan>();
  private wanted = new Map<string, string>();
  private queue = new Set<string>();
  private controller = new AbortController();
  private inFlight = new Set<string>();
  private interested = true;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private seeds?: Map<string, SessionScan>;
  private retainedBytes = 0;

  private discardText(entry: SessionScan) {
    const previewOnly = ({
      searchText: _searchText,
      ...match
    }: SessionContentMatch) => match;
    this.retainedBytes -= entry.retainedBytes;
    entry.retainedBytes = 0;
    entry.matches = entry.matches.map(previewOnly);
    entry.found = new Map(
      [...entry.found].map(([id, match]) => [id, previewOnly(match)]),
    );
    entry.refinable = false;
  }

  constructor(
    readonly query: string,
    private readonly request: {
      roles: Array<"assistant" | "user">;
      after?: number;
      before?: number;
    },
    private readonly transport: Pick<SourceTransport, "fetch">,
    private readonly changed: () => void,
    private readonly pool = new ContentSearchPool(),
    private readonly limits = {
      matches: MAX_CACHED_MATCHES_PER_SESSION,
      sessionBytes: MAX_CACHED_SEARCH_TEXT_BYTES_PER_SESSION,
      scanBytes: MAX_CACHED_SEARCH_TEXT_BYTES_PER_SCAN,
    },
  ) {}

  seedFrom(previous: ContentSearchScan) {
    if (this.query.startsWith(previous.query))
      this.seeds = new Map(
        [...previous.entries].map(([id, entry]) => [id, entry.seed ?? entry]),
      );
  }

  update(wanted: Map<string, string>) {
    this.wanted = wanted;
    for (const id of this.queue) if (!wanted.has(id)) this.queue.delete(id);
    for (const [id, revision] of wanted) {
      if (this.inFlight.has(id)) continue;
      let entry = this.entries.get(id);
      if (!entry || (entry.done && entry.revision !== revision)) {
        if (entry?.limited) continue;
        const seed = !entry ? this.seeds?.get(id) : undefined;
        this.seeds?.delete(id);
        const resume = entry?.resumeCursor;
        if (entry && !resume) this.discardText(entry);
        entry = {
          revision,
          matches: entry?.matches ?? [],
          partial: entry?.partial,
          done: false,
          cursor: resume,
          tailing: !!resume,
          found: new Map(resume ? entry?.matches.map((m) => [m.id, m]) : []),
          diagnostics: entry?.diagnostics ?? [],
          foundDiagnostics: new Map(
            resume ? entry?.diagnostics.map((d) => [d.id, d]) : [],
          ),
          workPartial: resume ? entry?.partial : undefined,
          retries: 0,
          started: false,
          acquisitionQuery: resume ? entry!.acquisitionQuery : this.query,
          retainedBytes: entry?.retainedBytes ?? 0,
          refinable: resume ? entry!.refinable : true,
          limited: false,
          seed:
            seed?.refinable &&
            !seed.limited &&
            (seed.cursor || seed.resumeCursor)
              ? seed
              : undefined,
        };
        this.entries.set(id, entry);
        this.queue.add(id);
      } else if (!entry.done) this.queue.add(id);
    }
    this.schedule();
  }

  setInterested(interested: boolean) {
    if (this.stopped || this.interested === interested) return;
    this.interested = interested;
    if (interested) {
      this.controller = new AbortController();
      this.update(this.wanted);
    } else {
      this.pool.remove(this);
      this.controller.abort();
      for (const entry of this.entries.values())
        if (!entry.done) entry.started = false;
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  stop() {
    this.setInterested(false);
    this.stopped = true;
    this.queue.clear();
    this.seeds = undefined;
  }

  private schedule() {
    if (
      this.timer ||
      this.stopped ||
      !this.interested ||
      this.controller.signal.aborted ||
      !this.queue.size
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.enqueue();
    }, 32);
  }

  private enqueue() {
    if (this.stopped || !this.interested || !this.queue.size) return;
    this.pool.add(this, () => this.next());
  }

  private next(): Promise<void> | undefined {
    if (this.stopped || !this.interested || this.controller.signal.aborted)
      return;
    while (this.queue.size) {
      const id = this.queue.values().next().value!;
      this.queue.delete(id);
      if (!this.wanted.has(id) || this.inFlight.has(id)) continue;
      const entry = this.entries.get(id)!;
      if (entry.done) continue;
      this.inFlight.add(id);
      return this.read(id, entry);
    }
  }

  private async read(id: string, entry: SessionScan) {
    const signal = this.controller.signal;
    try {
      if (entry.seed) {
        if (!entry.seed.refinable || entry.seed.limited) entry.seed = undefined;
      }
      if (entry.seed) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) return;
        const seed = {
          ...entry.seed,
          found: new Map(entry.seed.found),
          foundDiagnostics: new Map(entry.seed.foundDiagnostics),
        };
        // Yield between bounded slices; newer needles can cancel unfinished refinement.
        let sliceStart = performance.now();
        const matches: SessionContentMatch[] = [];
        for (const hit of seed.found.values()) {
          const match = refineMatch(hit, this.query);
          if (match) matches.push(match);
          if (performance.now() - sliceStart >= 8) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (signal.aborted) return;
            sliceStart = performance.now();
          }
        }
        if (signal.aborted) return;
        entry.seed = undefined;
        entry.matches = matches;
        entry.found = new Map(matches.map((match) => [match.id, match]));
        entry.retainedBytes = matches.reduce(
          (sum, match) => sum + 2 * match.searchText!.length,
          0,
        );
        this.retainedBytes += entry.retainedBytes;
        entry.acquisitionQuery = seed.acquisitionQuery;
        entry.cursor = seed.cursor ?? seed.resumeCursor;
        entry.resumeCursor = seed.resumeCursor;
        entry.tailing = seed.done;
        entry.revision = seed.revision;
        entry.diagnostics = seed.diagnostics;
        entry.foundDiagnostics = new Map(seed.foundDiagnostics);
        entry.partial = seed.partial;
        entry.workPartial = seed.workPartial;
        entry.done = seed.done && seed.revision === this.wanted.get(id);
        if (this.retainedBytes > this.limits.scanBytes) {
          entry.limited = true;
          entry.done = true;
          entry.resumeCursor = undefined;
          this.discardText(entry);
        }
        if (entry.done) return;
      }
      if (!entry.started) {
        entry.revision = this.wanted.get(id)!;
        entry.started = true;
      }
      try {
        const batch = await this.transport.fetch<SessionContentSearchBatch>(
          "/sessions/content-search",
          {
            method: "POST",
            signal,
            body: JSON.stringify({
              sessionId: id,
              query: entry.acquisitionQuery,
              ...this.request,
              cursor: entry.cursor,
              allowRestart: true,
              includeSearchText: true,
            }),
          },
        );
        if (signal.aborted) return;
        if (!batch.done && !batch.cursor)
          throw new Error("Incomplete search batch has no continuation");
        entry.retries = 0;
        if (batch.reset) {
          entry.tailing = false;
          this.retainedBytes -= entry.retainedBytes;
          entry.retainedBytes = 0;
          entry.refinable = true;
          entry.found.clear();
          entry.foundDiagnostics.clear();
          entry.matches = [];
          entry.diagnostics = [];
          entry.partial = undefined;
          entry.workPartial = undefined;
        }
        for (const diagnostic of batch.diagnostics ?? [])
          entry.foundDiagnostics.set(diagnostic.id, diagnostic);
        if (!batch.includesSearchText) entry.refinable = false;
        for (const id of batch.replacedIds ?? []) {
          const old = entry.found.get(id);
          const bytes = 2 * (old?.searchText?.length ?? 0);
          entry.retainedBytes -= bytes;
          this.retainedBytes -= bytes;
          entry.found.delete(id);
        }
        let sliceStart = performance.now();
        for (const hit of batch.matches) {
          if (performance.now() - sliceStart >= 8) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (signal.aborted) return;
            sliceStart = performance.now();
          }
          let match =
            hit.searchText !== undefined ? refineMatch(hit, this.query) : hit;
          if (!match) continue;
          const oldBytes =
            2 * (entry.found.get(match.id)?.searchText?.length ?? 0);
          let bytes = 2 * (match.searchText?.length ?? 0);
          if (
            entry.retainedBytes + bytes - oldBytes > this.limits.sessionBytes ||
            this.retainedBytes + bytes - oldBytes > this.limits.scanBytes
          ) {
            const { searchText: _searchText, ...preview } = match;
            match = preview;
            bytes = 0;
            entry.limited = true;
          }
          entry.retainedBytes += bytes - oldBytes;
          this.retainedBytes += bytes - oldBytes;
          entry.found.set(match.id, match);
          if (entry.limited || entry.found.size >= this.limits.matches) {
            entry.limited = true;
            entry.refinable = false;
            break;
          }
        }
        if (batch.partial)
          entry.workPartial =
            batch.unavailable ??
            entry.foundDiagnostics.values().next().value?.message ??
            "";
        entry.cursor = batch.done ? undefined : batch.cursor;
        entry.resumeCursor = batch.resumeCursor;
        entry.done = batch.done || entry.limited;
        if (entry.limited) {
          entry.resumeCursor = undefined;
          this.discardText(entry);
        }
        const visible = new Map(
          entry.done ? [] : entry.matches.map((m) => [m.id, m]),
        );
        for (const match of entry.found.values()) visible.set(match.id, match);
        entry.matches = [...visible.values()];
        const details = new Map(
          entry.done ? [] : entry.diagnostics.map((d) => [d.id, d]),
        );
        for (const diagnostic of entry.foundDiagnostics.values())
          details.set(diagnostic.id, diagnostic);
        entry.diagnostics = [...details.values()];
        if (entry.done) entry.partial = entry.workPartial;
        else if (entry.workPartial !== undefined)
          entry.partial = entry.workPartial;
      } catch (error) {
        if (signal.aborted) return;
        const status =
          error && typeof error === "object" && "status" in error
            ? error.status
            : undefined;
        if (status === 429) {
          await waitForCapacity(signal);
        } else if (
          status === 409 ||
          (entry.cursor && status === 400 && entry.retries++ === 0)
        ) {
          if (status === 409) await waitForCapacity(signal);
          this.discardText(entry);
          entry.refinable = true;
          entry.cursor = undefined;
          entry.resumeCursor = undefined;
          entry.found.clear();
          entry.tailing = false;
          entry.foundDiagnostics.clear();
          entry.workPartial = undefined;
        } else {
          entry.partial =
            error instanceof Error ? error.message : String(error);
          entry.diagnostics = [
            {
              id: "request",
              message: entry.partial,
              messageId: entry.matches.at(-1)?.id,
            },
          ];
          entry.done = true;
          entry.resumeCursor = undefined;
        }
      }
    } finally {
      this.inFlight.delete(id);
      if (this.wanted.has(id) && !this.stopped) {
        if (signal.aborted) this.update(this.wanted);
        else {
          if (!entry.done) this.queue.add(id);
          else if (entry.revision !== this.wanted.get(id))
            this.update(this.wanted);
        }
      }
      if (!signal.aborted) this.changed();
      this.enqueue();
    }
  }
}
