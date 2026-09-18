# Client and server work continues after its consumers lose interest

Several views suppress stale results but still finish requests and computation
after navigation, dismissal, or a newer query. These are individually fixable.
Adopting Effect, or building an equivalent lifecycle framework, is not a
prerequisite: start with explicit owners, AbortSignals, and cleanup at the
existing boundaries. Shared computations and transport changes need additional
care only where a particular fix crosses those boundaries.

## Verified evidence

Code checked 2026-09-16; paths below are relative to `packages/`.

- `client/src/lib/connection/RelayProtocol.ts` now releases a request's pending
  slot on `init.signal` abort. This fixes transport support, not every caller:
  `client/src/pages/BlameView.tsx` and
  `client/src/pages/ReviewSubmitModal.tsx` still use only a `cancelled` latch
  for their file/blame and review-preview reads.
- `client/src/api/sourceApiFetch.ts` **already accepts `RequestInit`**, including
  a signal. The missing plumbing is in endpoint wrappers such as
  `fileApi.getFile`, `gitApi.getGitBlame`, and `reviewApi.previewReview` in
  `client/src/api/{fileClient,gitClient,reviewClient}.ts`.
- `client/src/components/session-search/ContentSearchScan.ts` is an existing
  example of cancelling both acquisition and browser work: it checks the signal
  between bounded refinement slices and makes `waitForCapacity` abortable.
- `server/src/routes/review-comments.ts` preview calls
  `server/src/review/relocateAnchors.ts`, whose workers (up to eight) read files
  and spawn line-blame commands until all anchors finish. Neither accepts a
  signal. `server/src/git/gitExec.ts` also lacks a signal option. Preview is
  read-only despite using POST; submission separately reuses relocation.
- `server/src/routes/session-content-search.ts` admits four requests and joins
  reads through `server/src/lib/sourceVersionedSingleFlight.ts`. The reader
  gets a 30-second timeout, not caller cancellation. This instance retains
  **no completed batches** (`shouldRetain: () => false`); an abandoned request
  occupies admission capacity until it finishes. The shared utility has no
  waiter-interest tracking.
- Ordinary requests replayed through `server/src/routes/ws-relay-handlers.ts`
  receive no abort signal. Only preauth public-share requests have a controller
  wired to `cleanupConnectionState`. The installed Node HTTP adapter does abort
  a materialized request's signal on premature response-connection close;
  handlers must observe and propagate it. Its lazy controller is materialized
  by several Request properties, not exclusively `.signal`.

The cases above establish missing cancellation; their actual savings still
need measurement.

## Choose the lifetime by the work

View-only reads and queued browser derivations should stop when superseded or
unmounted. Keep stale-result guards for completion races; cancelling a promise
alone does not interrupt synchronous parsing or already-running computation.
Check before expensive stages and yield between bounded CPU-work slices.

Shared work must survive one waiter leaving while another still needs it.
After the last waiter leaves, stop unless a named cache/background owner elects
to finish under bounded concurrency, time, and retention budgets. Cache fills
can be worthwhile: `server/src/git/blame.ts` already retains completed blame
results in a 32 MiB cache. Prefer retaining reusable results, such as an immutable
revision, when their expected reuse justifies the remaining cost. Record that
choice per operation; merely having a cache is not a reason to finish every
obsolete request. Preserve source-version validation on publication.

Accepted mutations and provider turns have a server-owned lifetime. Keep Git
fetch/pull/push and review submission out of view-triggered cancellation; closing
their UI is not a request to undo or interrupt them. Classify by semantics,
not HTTP method.

## Concrete implementation plan

Each item can land separately. Items 1–2 do not depend on shared-work changes
or a new relay frame. All items remain open; this revision changes the plan only.

1. **Cancel dismissed review previews.** Add an optional signal to
   `reviewApi.previewReview`, pass it through the existing `fetchJSON`, and
   abort from `ReviewSubmitModal` cleanup. Thread the direct HTTP request signal
   through `relocateAnchors`, file reads, and `runGit`; stop taking new anchors
   after abort. Preserve abort errors through the current best-effort catches,
   and leave submission's server-owned call unchanged. Test dismissal through
   the real preview route: no subsequent anchors start, active child processes
   exit, and submission still completes when its client disconnects.
2. **Cancel superseded file/blame consumers.** Add optional signals to
   `fileApi.getFile` and `gitApi.getGitBlame`; have `BlameView` abort on
   project/path/revision change and unmount. Retain stale-result guards. Test
   rapid A→B navigation with delayed A: A's caller settles, relay pending state
   is released, and A cannot start further client derivation or replace B.
   Choose server blame's cache-fill policy separately; client cancellation is
   useful even when the server deliberately finishes reusable work.
3. **Stop unused content-search batches.** Extend the existing single-flight
   owner with per-waiter cancellation and an explicit last-waiter policy. Use
   stop-on-last-waiter for the unretained batch read. Register each request's
   `c.req.raw.signal` as waiter interest; combine the compute owner's signal
   with the existing timeout. Detach an aborted waiter promptly and skip its
   match filtering/serialization. Test two joiners, one leaving, both leaving,
   timeout, and a fresh arrival during cancellation. Preserve source-version
   fencing and bound live compute independently of detached request slots, so
   early slot release cannot admit unlimited still-stopping reads.
4. **Release requests on connection teardown.** Extend the existing WebSocket
   connection cleanup to detach that connection's read waiters and abort its
   unshared view-only work. Trace direct WS, secure, relay, and multiplexed
   logical-client teardown; do not tie unrelated clients to one physical socket.
   Test closing one client while another keeps shared work alive. This can use
   existing disconnect events without a new cancellation frame; it cannot
   detect navigation over a connection that remains open.
5. **Cancel individual requests over live connections.** Add a capability-gated
   request-ID cancellation message for multiplexed transports, after the
   [compatibility review](../DEVELOPMENT.md#clientserver-compatibility-review).
   Scope IDs to the authenticated logical connection, make late/duplicate
   cancellation harmless, and retain client-only abort with older servers.
   Test a superseded search without closing the socket, alongside old/new peer
   combinations. Coordinate with the existing
   [search ownership gap](all-sessions-search-index.md); do not create a second
   competing viewer-generation protocol.

For each item, report work avoided (anchors, subprocesses, batches, or client
derivations), not just absence of stale UI. Cancellation tests must fail when
the signal is dropped. Cache-retention tests should instead prove bounded
completion and later reuse. Search changes also need sequential typing under
concurrent results, with every keystroke acknowledged within 100 ms.

This applies the existing [resource ownership and bounded shared-work
contract](../topics/architecture-mandates.md). It was left open during the
transport fix because these callers need separate edits and verification,
not because they require a system-wide redesign.

Found 2026-09-15 while auditing abort propagation after fixing the relay
transport's dropped `signal`.
