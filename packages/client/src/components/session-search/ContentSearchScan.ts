import {
  getCollapsedSearchPreviewText,
  normalizeSearchPreviewText,
  type SessionContentMatch,
  type SessionContentDiagnostic,
  type SessionContentSearchBatch,
} from "@yep-anywhere/shared";
import type { SourceTransport } from "../../lib/transport";

/**
 * Where one session's read stands, with the cursors that stage actually has.
 *
 * `seeded` refines a previous needle's cached text before reading anything;
 * `acquiring` has a read outstanding or queued, continuing at `cursor` and
 * remembering `tail` for the next live top-up, with `fromTail` recording that
 * this pass started from a finished read; `done` covers `revision` completely;
 * `limited` hit a cache cap, so its text is gone and it cannot resume; `failed`
 * reports its message through the entry's `partial` and `diagnostics`.
 */
export type ScanPhase =
  | { kind: "seeded"; seed: SessionScan }
  | { kind: "acquiring"; cursor?: string; tail?: string; fromTail: boolean }
  | { kind: "done"; tail?: string }
  | { kind: "limited" }
  | { kind: "failed" };

export interface SessionScan {
  revision: string;
  matches: SessionContentMatch[];
  partial?: string;
  found: Map<string, SessionContentMatch>;
  diagnostics: SessionContentDiagnostic[];
  foundDiagnostics: Map<string, SessionContentDiagnostic>;
  workPartial?: string;
  retries: number;
  started: boolean;
  acquisitionQuery: string;
  retainedBytes: number;
  refinable: boolean;
  phase: ScanPhase;
}

export const MIN_TURN_SEARCH_QUERY_LENGTH = 1;
export const MAX_CACHED_MATCHES_PER_SESSION = 1024;
export const MAX_CACHED_SEARCH_TEXT_BYTES_PER_SESSION = 2 * 1024 * 1024;
export const MAX_CACHED_SEARCH_TEXT_BYTES_PER_SCAN = 32 * 1024 * 1024;

/** No further read will change this session's rows for the revision it holds. */
export function scanDone(entry: SessionScan) {
  const { kind } = entry.phase;
  return kind === "done" || kind === "limited" || kind === "failed";
}

/** A cache cap stopped this session short, so its retained text is gone. */
export function scanLimited(entry: SessionScan) {
  return entry.phase.kind === "limited";
}

/**
 * The rows already reflect a finished read: complete, topping up a finished
 * read's tail, or refining a finished seed. Only a first acquisition is not.
 */
export function scanHasCompletePass(entry: SessionScan) {
  const phase = entry.phase;
  if (phase.kind === "acquiring") return phase.fromTail;
  if (phase.kind === "seeded") return scanDone(phase.seed);
  return true;
}

/** Where a scan adopting this seed would continue reading. */
function seedCursor(seed: SessionScan) {
  const phase = seed.phase;
  if (phase.kind === "acquiring") return phase.cursor ?? phase.tail;
  return phase.kind === "done" ? phase.tail : undefined;
}

/** A seed still holds refinable text; the generation that made it runs on and may discard it. */
function seedIsRefinable(seed: SessionScan) {
  return seed.refinable && seed.phase.kind !== "limited";
}

const matchBytes = (match: SessionContentMatch) =>
  2 * (match.searchText?.length ?? 0);

const yieldToTimer = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

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

/** The only writer of retained search text: session and whole-scan byte ledgers move together. */
class RetainedTextBudget {
  private scanBytes = 0;

  constructor(
    private readonly limits: { sessionBytes: number; scanBytes: number },
  ) {}

  add(entry: SessionScan, bytes: number) {
    entry.retainedBytes += bytes;
    this.scanBytes += bytes;
  }

  remove(entry: SessionScan, bytes: number) {
    this.add(entry, -bytes);
  }

  /** Give back everything this session holds; the caller is replacing the text itself. */
  release(entry: SessionScan) {
    this.remove(entry, entry.retainedBytes);
  }

  /** Drop this session's text with its bytes, leaving previews that can no longer be refined. */
  discard(entry: SessionScan) {
    const previewOnly = ({
      searchText: _searchText,
      ...match
    }: SessionContentMatch) => match;
    this.release(entry);
    entry.matches = entry.matches.map(previewOnly);
    entry.found = new Map(
      [...entry.found].map(([id, match]) => [id, previewOnly(match)]),
    );
    entry.refinable = false;
  }

  wouldExceed(entry: SessionScan, bytes: number) {
    return (
      entry.retainedBytes + bytes > this.limits.sessionBytes ||
      this.scanBytes + bytes > this.limits.scanBytes
    );
  }

  get overScanLimit() {
    return this.scanBytes > this.limits.scanBytes;
  }
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
  private readonly budget: RetainedTextBudget;

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
  ) {
    this.budget = new RetainedTextBudget(limits);
  }

  seedFrom(previous: ContentSearchScan) {
    if (this.query.startsWith(previous.query))
      this.seeds = new Map(
        [...previous.entries].map(([id, entry]) => [
          id,
          entry.phase.kind === "seeded" ? entry.phase.seed : entry,
        ]),
      );
  }

  update(wanted: Map<string, string>) {
    this.wanted = wanted;
    for (const id of this.queue) if (!wanted.has(id)) this.queue.delete(id);
    for (const [id, revision] of wanted) {
      if (this.inFlight.has(id)) continue;
      let entry = this.entries.get(id);
      if (!entry || (scanDone(entry) && entry.revision !== revision)) {
        if (entry?.phase.kind === "limited") continue;
        const seed = !entry ? this.seeds?.get(id) : undefined;
        this.seeds?.delete(id);
        const resume =
          entry?.phase.kind === "done" ? entry.phase.tail : undefined;
        if (entry && !resume) this.budget.discard(entry);
        entry = {
          revision,
          matches: entry?.matches ?? [],
          partial: entry?.partial,
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
          phase:
            seed && seedIsRefinable(seed) && seedCursor(seed) !== undefined
              ? { kind: "seeded", seed }
              : { kind: "acquiring", cursor: resume, fromTail: !!resume },
        };
        this.entries.set(id, entry);
        this.queue.add(id);
      } else if (!scanDone(entry)) this.queue.add(id);
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
        if (!scanDone(entry)) entry.started = false;
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
      if (scanDone(entry)) continue;
      this.inFlight.add(id);
      return this.read(id, entry);
    }
  }

  private async read(id: string, entry: SessionScan) {
    const signal = this.controller.signal;
    try {
      if (entry.phase.kind === "seeded") {
        const seed = entry.phase.seed;
        if (!seedIsRefinable(seed))
          entry.phase = { kind: "acquiring", fromTail: false };
        else {
          await this.applySeed(id, entry, seed, signal);
          if (signal.aborted || scanDone(entry)) return;
        }
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
              cursor:
                entry.phase.kind === "acquiring"
                  ? entry.phase.cursor
                  : undefined,
              allowRestart: true,
              includeSearchText: true,
            }),
          },
        );
        if (signal.aborted) return;
        if (!batch.done && !batch.cursor)
          throw new Error("Incomplete search batch has no continuation");
        await this.applyBatch(entry, batch, signal);
      } catch (error) {
        if (signal.aborted) return;
        await this.handleReadError(entry, error, signal);
      }
    } finally {
      this.inFlight.delete(id);
      if (this.wanted.has(id) && !this.stopped) {
        if (signal.aborted) this.update(this.wanted);
        else {
          if (!scanDone(entry)) this.queue.add(id);
          else if (entry.revision !== this.wanted.get(id))
            this.update(this.wanted);
        }
      }
      if (!signal.aborted) this.changed();
      this.enqueue();
    }
  }

  /** Refine a previous needle's cached text instead of re-reading the session. */
  private async applySeed(
    id: string,
    entry: SessionScan,
    seed: SessionScan,
    signal: AbortSignal,
  ) {
    await yieldToTimer();
    if (signal.aborted) return;
    const cached = new Map(seed.found);
    // Yield between bounded slices; newer needles can cancel unfinished refinement.
    let sliceStart = performance.now();
    const matches: SessionContentMatch[] = [];
    for (const hit of cached.values()) {
      const match = refineMatch(hit, this.query);
      if (match) matches.push(match);
      if (performance.now() - sliceStart >= 8) {
        await yieldToTimer();
        if (signal.aborted) return;
        sliceStart = performance.now();
      }
    }
    if (signal.aborted) return;
    entry.matches = matches;
    entry.found = new Map(matches.map((match) => [match.id, match]));
    this.budget.release(entry);
    this.budget.add(
      entry,
      matches.reduce((sum, match) => sum + matchBytes(match), 0),
    );
    entry.acquisitionQuery = seed.acquisitionQuery;
    entry.revision = seed.revision;
    entry.diagnostics = seed.diagnostics;
    entry.foundDiagnostics = new Map(seed.foundDiagnostics);
    entry.partial = seed.partial;
    entry.workPartial = seed.workPartial;
    const complete = scanDone(seed);
    const tail = seed.phase.kind === "done" ? seed.phase.tail : undefined;
    entry.phase =
      complete && seed.revision === this.wanted.get(id)
        ? { kind: "done", tail }
        : {
            kind: "acquiring",
            cursor: seedCursor(seed),
            tail,
            fromTail: complete,
          };
    if (this.budget.overScanLimit) {
      entry.phase = { kind: "limited" };
      this.budget.discard(entry);
    }
  }

  /** Fold one server batch into the session's rows, within the retained-text caps. */
  private async applyBatch(
    entry: SessionScan,
    batch: SessionContentSearchBatch,
    signal: AbortSignal,
  ) {
    entry.retries = 0;
    let fromTail =
      entry.phase.kind === "acquiring" ? entry.phase.fromTail : false;
    let limited = false;
    if (batch.reset) {
      fromTail = false;
      this.budget.release(entry);
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
      if (old) this.budget.remove(entry, matchBytes(old));
      entry.found.delete(id);
    }
    let sliceStart = performance.now();
    for (const hit of batch.matches) {
      if (performance.now() - sliceStart >= 8) {
        await yieldToTimer();
        if (signal.aborted) return;
        sliceStart = performance.now();
      }
      let match =
        hit.searchText !== undefined ? refineMatch(hit, this.query) : hit;
      if (!match) continue;
      const previous = entry.found.get(match.id);
      const oldBytes = previous ? matchBytes(previous) : 0;
      let bytes = matchBytes(match);
      if (this.budget.wouldExceed(entry, bytes - oldBytes)) {
        const { searchText: _searchText, ...preview } = match;
        match = preview;
        bytes = 0;
        limited = true;
      }
      this.budget.add(entry, bytes - oldBytes);
      entry.found.set(match.id, match);
      if (limited || entry.found.size >= this.limits.matches) {
        limited = true;
        entry.refinable = false;
        break;
      }
    }
    if (batch.partial)
      entry.workPartial =
        batch.unavailable ??
        entry.foundDiagnostics.values().next().value?.message ??
        "";
    if (limited) {
      entry.phase = { kind: "limited" };
      this.budget.discard(entry);
    } else if (batch.done)
      entry.phase = { kind: "done", tail: batch.resumeCursor };
    else
      entry.phase = {
        kind: "acquiring",
        cursor: batch.cursor,
        tail: batch.resumeCursor,
        fromTail,
      };
    const done = scanDone(entry);
    const visible = new Map(
      done ? [] : entry.matches.map((m) => [m.id, m] as const),
    );
    for (const match of entry.found.values()) visible.set(match.id, match);
    entry.matches = [...visible.values()];
    const details = new Map(
      done ? [] : entry.diagnostics.map((d) => [d.id, d] as const),
    );
    for (const diagnostic of entry.foundDiagnostics.values())
      details.set(diagnostic.id, diagnostic);
    entry.diagnostics = [...details.values()];
    if (done || entry.workPartial !== undefined)
      entry.partial = entry.workPartial;
  }

  /** Back off, restart the traversal, or leave the session showing why it stopped. */
  private async handleReadError(
    entry: SessionScan,
    error: unknown,
    signal: AbortSignal,
  ) {
    const status =
      error && typeof error === "object" && "status" in error
        ? error.status
        : undefined;
    if (status === 429) {
      await waitForCapacity(signal);
      return;
    }
    const restartable =
      entry.phase.kind === "acquiring" &&
      entry.phase.cursor !== undefined &&
      entry.retries === 0;
    if (status === 409 || (status === 400 && restartable)) {
      if (status === 409) await waitForCapacity(signal);
      else entry.retries++;
      this.budget.discard(entry);
      entry.refinable = true;
      entry.found.clear();
      entry.foundDiagnostics.clear();
      entry.workPartial = undefined;
      entry.phase = { kind: "acquiring", fromTail: false };
      return;
    }
    entry.partial = error instanceof Error ? error.message : String(error);
    entry.diagnostics = [
      {
        id: "request",
        message: entry.partial,
        messageId: entry.matches.at(-1)?.id,
      },
    ];
    entry.phase = { kind: "failed" };
  }
}
