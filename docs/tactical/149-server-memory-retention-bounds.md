# Server memory retention bounds

Topic: server-performance-observability

Status: implemented 2026-10-07 (steps 1–8). Step 9 is partial: unit tests
cover the bounded owners; the watcher test checks the store seen when a
watch is created, not delivery from a real watch or collectability, and the
full-history repeat sweep has not been rerun.

## Objective

Make every long-lived server cache release its memory without a restart, and
make a bounded retention contract a standing architecture rule instead of a
per-incident fix.

## Evidence

A full-history session audit sweep (564 sessions) on a standalone server, run
with `--expose-gc` and measured after forced collection, motivated the Codex
parsed-transcript budget (commit `2fbffbe90`, 3.0 GB → about 1.1 GB live heap
after the sweep). With both transcript caches set to 0, the same sweep still
left 560–570 MB of live heap against an idle baseline near 130 MB, and
500–590 MB of external memory. Two further sweeps kept the heap flat, so the
remainder is pinned rather than growing per sweep.

**Current:** heap-snapshot retainer paths attribute the remainder to:

1. **Request context captured by directory watches.** About 100 live
   `FSWatcher` handles each retain an `AsyncContextFrame` whose
   `markdownCacheObserver` store is the `observeCacheResult` closure from
   `augmentPersistedSessionMessages`. That closure shares its V8 context with
   `messages`, so each watch keeps one request's whole augmented message array
   alive (1–185 MB each) until the watch closes. Watches are created lazily by
   the project path index while augmentation checks displayed paths, which is
   why they are born inside the request scope. Every native watch is created by
   `SharedDirectoryWatcher.configure`, so that one call site governs all
   consumers (path index, provider session watchers, focused session watch,
   glossary, worktree, source watcher).
2. **Shiki Oniguruma WebAssembly memory.** 430–590 MB of external memory held
   by the Oniguruma binding's `HEAPU8`. WebAssembly memory grows but never
   shrinks; it rose once to 587 MB and then held across sweeps, so it is a
   high-water mark, not a per-sweep leak.
3. **Bounded caches confirmed within budget:** markdown HTML single-flight
   (32 MB), transient tool-result media (64 MB plus TTL), highlight cache
   (32 MB), Claude and Codex parsed transcripts.

A static audit of process-lifetime maps and sets found further unbounded
owners that the sweep did not exercise (step names below).

## Boundaries

- Do not discard canonical session state, pending writes, active protocol
  ownership, or the only copy of user data to satisfy a bound.
- Do not add a timer per session, project, or cache; idle release uses one
  process-wide sweep or on-access eviction (see the topic's memory-pressure
  containment section).
- Semantic sets (an entry's absence changes behavior) are not caches. Bound
  them by lifecycle or by consulting durable state, never by blind eviction;
  small ones may stay unbounded under step 1's documented-growth clause.

## Steps

### 1 — record the bounded-retention rule

Add an architecture rule to `ARCHITECTURE.md`, with the detailed contract in
`topics/server-performance-observability.md`:

> Any process-lifetime map, set, array, or cache whose key space grows with
> sessions, projects, files, requests, or time must have a declared bound: a
> byte or entry LRU, a TTL with a process-wide sweep, lifecycle deletion tied
> to the owning object, a proof that its key space is fixed, or an accepted
> small per-entry cost whose growth is documented (for example, one session ID
> per session seen since process start). A plain `Map` or `Set` field on a
> long-lived service needs a comment naming its bound.

Prefer the existing `createLruMap`/`refreshLruMap` and
`SourceVersionedSingleFlight` primitives over new ones. Include the
context-capture hazard: long-lived async resources (watches, intervals,
sockets, workers) must be created outside request-scoped
`AsyncLocalStorage` contexts.

### 2 — create directory watches outside request context

In `SharedDirectoryWatcher`, capture `AsyncLocalStorage.snapshot()` at module
load and create the native `watch()` through it, so the handle captures the
empty context frame. After the request finishes, nothing then references its
observer or messages and they are collected. This also stops watch callbacks
from running inside a finished request's context.

As defense in depth, build the `observeCacheResult` closure in a helper that
captures only the diagnostics object, so any other long-lived resource that
captures the frame pins a few counters instead of a transcript.

### 3 — move Shiki highlighting into a recyclable worker

Both highlight paths (`highlighting/index.ts` and
`augments/augment-generator.ts`) call `codeToHtml` after an `await`, so a
worker boundary does not change caller shape. Run one worker that owns the
highlighter, its grammars, and the Oniguruma instance; keep the byte-bounded
highlight cache on the main thread. Recycle the worker after a measured
WebAssembly memory threshold, a job count, or idle time, and fall back to
unhighlighted output on worker failure or timeout.

**Current (resolved Open):** `createStreamCoordinator` created a new augment
generator, and therefore a new `Highlighter`, per stream and never disposed
it. Measured standalone: 40 highlighters dropped without `dispose()` raised
external memory from 17 to 300 MB, while disposing kept it flat at 18 MB; 60
dropped highlighters with five languages each reached 1.86 GB. Undisposed
per-stream highlighters were therefore the main WebAssembly growth source.
The worker now owns the process's only highlighter.

Result: `highlight-worker.mjs` (plain JavaScript, copied to `dist` by
`copy-server-assets.mjs`) and `HighlightWorkerHost`. The worker reports its
isolate's `process.memoryUsage().external` after each job. A `dist` smoke run
with a 30 MB budget and ten 130 KB files per round retired one worker per
round, and each fresh worker started again near 20 MB external memory.
The worker holds the event loop only while it runs a job: the host refs it
on dispatch and unrefs it on every reply, because delivering a message refs
its port again on Node 24 and otherwise short-lived scripts that highlight
never exit.

Review follow-up: the worker first received every job at once, so a worker
retired by budget kept growing while it drained its backlog, and concurrent
requests could keep several over-budget workers alive. A stall also rejected
every queued job, and those fallbacks were retained in the Markdown cache.
The host now queues on the main thread and sends one job at a time; a crash or
stall rejects only that job with `HighlightWorkerUnavailableError` (the whole
queue only when the worker never completed a job), and a block rendered after
that error is marked degraded so its Markdown is not retained.

### 4 — bound project file completion inventories

`services/projectFileCompletion.ts` `inventories` caps each project at
128 MB / 1M paths but not the total, and drops unused inventories only after
7 days and only on the next `acquire()`. Add a process-wide byte LRU across
projects and release idle inventories from one process-wide sweep. Related
deferred persistence: `gaps/sketches/project-file-completion-persistence.md`.

Result: a 256 MiB process-wide byte LRU over published inventories that
never releases in-flight scans or the inventory just published. The
documented one-week unused expiry and 100-project coexistence (for small and
medium projects) stand, and expiry also runs from the idle sweep.

### 5 — bound git untracked snapshots

`services/GitUntrackedCacheService.ts` `states` holds up to 50,000 untracked
paths per project and never deletes. The snapshots are already persisted
under app data, so convert the in-memory map to an entry/byte LRU that reloads
from disk on miss.

Result: a 16-project LRU. Only idle states are evicted; every query awaits
its own persistence, so a replacement state reads the latest snapshot.

### 6 — complete the session index and scan cache evictions

- `SessionIndexService` FIFO eviction deletes only `indexCache`; also delete
  that scope's `persistedIndexScopes`, `dirtyRevisions`, and
  `lastFullValidationAt` entries, and retouch on hit.
- `codexSharedScanCache` keeps one provider-wide file array per UTC-day
  auto-archive cutoff; retain only the current and in-flight cutoff per
  sessions directory.
- The app reader cache (500-entry FIFO) gains hit retouch.

Result: as listed. Eviction keeps a scope's dirty flags, which are semantic;
its dirty revision is dropped only when the scope is clean, and revisions
come from one process-wide counter so a dropped revision never repeats. Codex scans keep
the unfiltered scan plus the latest settled cutoff per sessions directory.

### 7 — bound the remaining per-session and per-site maps

- `VocabularyStore.sessionTops` (a 100-term top list per session, a few KB
  each) and `linkedSiteCache.linkedSites` (whose per-site stamp maps grow with
  file count): entry LRU or lifecycle deletion.

**Decision (deferred):** the semantic per-session sets stay unbounded for now
and get a comment naming their bound per step 1. Each grows only with sessions
seen in one process lifetime and resets on restart; 10,000 sessions cost
roughly 1–20 MB in total.

- `ExternalSessionTracker` `createdSessions` (a session ID, about 100 B) and
  `sessionStateCache` (title, timestamps, counts, model, context usage, and a
  capped question-title list, about 0.5–2 KB). Dropping an entry would
  re-emit `session-created` or a spurious change, so a later bound should
  delete on session archive/removal rather than evict.
- `Supervisor.everOwnedSessions` (a session ID) feeds orphan detection.
- `SessionMetadataService.sessionIdAliases` (small ID pairs).

Revisit if the periodic resource sample shows them material.

Result: `sessionTops` is a 256-session LRU (an evicted session loses only its
in-memory boost, as on restart); `linkedSites` is a 64-walk LRU.

### 8 — record low-priority owners

Document, without changing, the owners whose key space is bounded by host,
model, project, or user count (`remoteHomeCache`, Gemini/OpenCode reader
caches, `ArtifactServer` host maps, `ReviewCommentService.releasedKeys`,
push notifier maps, and similar), each with a comment naming its bound per
step 1. `ToolResultMediaStore.pruneTransient` runs only on insert; prune on
read as well so the TTL holds when inserts stop.

Result: reads already pruned. The store now registers with the idle sweep
while it holds transient media, so the TTL holds when traffic stops.

### 9 — verification

- Unit: a watch created inside `AsyncLocalStorage.run` delivers its callback
  with `getStore()` undefined; a large object stored only in that context is
  collectable (`WeakRef` under `--expose-gc` where available).
- Unit: each bounded owner evicts at its limit, retouches on hit, and keeps
  semantic sets correct across eviction.
- Sweep: repeat the full-history sweep on a standalone server with both
  transcript caches at 0. Expect live heap after collection near the idle
  baseline plus bounded cache budgets, external memory dropping when the
  highlight worker recycles, and repeated sweeps staying flat.
- Update the topic's cache-owner table: the rows above, the corrected review
  project store row (now byte-bounded via `maxRetainedStoreBytes`), and the
  watcher-context finding.
