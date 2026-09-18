# Sent user turns can be absent from the live view until reload

Status: reported live omission remains unexplained. The related catch-up
ordering defect is fixed; recurrence instrumentation remains proposed.

## Observation and established evidence

On 2026-09-15, the sending window omitted two user turns while displaying the
assistant's reply to them. The user was scrolled up at least one full page
when pressing Enter. Reload restored the expected transcript. A screenshot
shows a long tool-activity group followed by the reply without the intervening
user turns; the original browser state was no longer available. A compaction
notice surfaced substantially later than the reply; do not assume compaction
caused the omission.

The affected Codex session was `01a09e0a-bae7-7cd0-a495-bb2c4cf207da`.
Its rollout contains user responses at `05:43:11.962Z` and `05:43:12.131Z`,
each immediately followed by an `item_completed` / `UserMessage` event with
a `client_id`. The assistant reply was persisted at `05:43:40.486Z`.
Those times establish persisted order, not browser send or paint times.
Both turns also appeared in current incremental REST reads starting after
the preceding tool call, `call_0tADPpUmXnVtKdZ4XdA5QNJx`, and in tail reads.
Delivery and persistence are established; correctness of the original live
provider notifications, transport, client state and viewport is not.

Expected behavior: the sending tab immediately represents an accepted composer
submission as pending/unconfirmed, then acknowledges it without a visibility
gap. Server acceptance and provider confirmation are distinct states. A delayed
or absent provider echo must not erase the local representation. Once durable
order is available, the user turns precede the response in the transcript.

Related incidents and owners:

- [Old-content motion recurrence](long-session-old-content-motion-recurrence.md)
  includes earlier disappearing steering rows and fixed stale-tail/paint races.
  Those fixes do not prove this recurrence has the same cause.
- [Unconfirmed send loss](unconfirmed-send-loss-across-reload.md) concerns
  unresolved delivery across reload/restart; this incident has durable turns.
- [Session detail data layer](../topics/session-detail-data-layer.md),
  [stream/persisted parity](../topics/stream-persisted-render-parity.md), and
  [scrollback stability](../topics/scrollback-view-stability.md) own the relevant
  data and viewport contracts. Receipt proposals belong to
  [remote browser diagnostics](../topics/remote-browser-diagnostics.md).

## Investigation and a demonstrated related defect

Investigation used checkout `d729f4bf3664521a0762ec8f000bcf878e86c5f7`.
The original tab's loaded bundle and the provider worker's revision were not
captured, so this is not an exact historical-runtime reproduction.

- `SessionPage.handleSend` adds a pending row before awaiting submission and
  increments `scrollTrigger`. `Process.queuePreparedMessage` emits YA's user
  echo with UUID and temporary submission ID before invoking `steerFn`.
  `useSession` clears pending rows on user echo and dispatches that message
  to the transcript reducer. A Codex echo failure alone does not explain loss
  of both independent YA representations.
- `MessageList` handles a send in a layout effect, clears pending initial
  scroll restoration, enables following, and writes the current bottom with
  delayed catch-up writes. This is already intended to override scroll-away;
  do not propose simply adding a send-to-bottom call as a new fix.
- A temporary Vitest probe replayed the actual REST rows through
  `reduceSessionDetailState`, `compileTranscriptProjection`, and
  `projectConversationView`. Both user prompts survived every later applied
  row in six cases: catch-up alone, user echo first, and response first, with
  Codex stream/durable ID alignment both enabled and disabled. The echo-first
  input used normalized durable rows as stand-ins, not captured live frames.
- Strengthening the oracle from presence to ordering exposed a failure with
  response-first arrival and ID alignment enabled. A second probe applying the
  complete durable batch at once reproduced it. Expected `[U1, U2, A]` became
  `[A, U1, U2]`, and Conversation view retained that order. Five control cases
  passed; these two ordering assertions failed without runtime warnings.
- The mechanism is visible in `lib/mergeMessages.ts`: `mergeJSONLMessages`
  keeps existing positions and appends newly discovered rows. Codex skips
  parent-chain ordering. In `lib/sessionDetail/transcriptReducer.ts`, enabling
  `codexStreamDurableIdAlignment` bypasses `reconcileLinearMessages`, whose
  timestamp sort previously repaired this order incidentally. Identity
  alignment does not itself restore durable sequence order.
- All 40 existing `MessageList.scroll.test.tsx` tests passed. They include
  steering before paint while following and resuming follow after a send, but
  do not establish actual browser paints for this long, scrolled-up session.

Client paths above are under `packages/client/src/`; the process owner is
`packages/server/src/supervisor/Process.ts`. The private live-data probe was
temporary; the ordering sequence now has an offline regression test.
The ordering defect does not establish why the original pending/live rows
failed to appear or whether those rows existed outside the viewport.

## Fixed portion: durable catch-up order

The client now anchors a durable batch by matching IDs, placing missed user
turns before an already streamed reply while preserving other retained rows.
An unanchored batch uses known timestamps for placement only; it does not
merge equal text or guess from equal/missing timestamps. The old-server
compatibility path is unchanged. The contract is in
[session detail data layer](../topics/session-detail-data-layer.md).

`packages/client/src/lib/sessionDetail/__tests__/transcriptReducer.ordering.test.ts`
covers batch and split arrival, repeated prompts, equal timestamps, a live
tail, overlapping refresh and reload parity.
`packages/client/e2e/session-catchup-order.spec.ts` exercises a live reply
followed by REST catch-up through the mounted session on desktop and phone.
These regressions address the demonstrated ordering defect, not the original
scrolled-up pending-row disappearance.

## Tests and discriminating probes to build

1. **Submission handoff.** Exercise the mounted session/composer with delayed
   HTTP acknowledgement, YA echo before/after that acknowledgement, provider
   echo withheld, and assistant output before durable catch-up. Assert the
   pending or transcript representation never disappears after send. Track
   acknowledgement provenance separately; HTTP success is not durable receipt.
   Include two rapid distinct sends and identical-text sends with distinct IDs.
2. **Scrolled-up browser reproduction.** Use an isolated server/profile and
   Playwright, a long transcript above the render-window threshold, Conversation
   view enabled, and an active tool call. Scroll at least one viewport up;
   sequentially type and press Enter while thinking/tool updates continue.
   Compare with following-bottom and full-transcript-view controls. Record
   animation-frame positions through pending insertion, echo replacement,
   durable reconciliation and reply rendering. Assert each typed character
   appears within 100 ms and inspect desktop/phone captures per UI testing.
3. **Boundary failures.** Delay/reorder individual transport and catch-up
   deliveries; test stale tail replacement, route retention, reconnect and
   render-window changes separately. First check whether the target ID is in
   canonical data, projected rows, mounted DOM, or only outside the viewport.
   Add compaction as a separate control, not a prerequisite for this report.

## Existing diagnostics and proposed recurrence capture

Existing `lib/diagnostics/uiTrace.ts` emits only while Remote Log Collection
is active. It already traces `pending-add`, `pending-remove`, submission
success/error, `user-echo`, and stream dispatch. High-rate token/augment events
are aggregated. `ClientLogCollector.ts` attaches a tab ID, retains a bounded
IndexedDB queue (currently 2,000 entries), and sends batches to server-side
`logs/client-logs/`. This is useful infrastructure, not proof that the failing
tab had collection enabled or that a pending-clear event identifies its cause.

Proposed additions should use that infrastructure and the existing diagnostic
consent/settings rather than start a parallel unbounded logger:

- Correlate source, session, tab, page-load identity, client/server build,
  process/provider turn, temporary submission ID, canonical message ID and
  render ID. Include monotonic event sequence plus wall-clock time; capture
  the actual submission route and relevant capabilities.
- Trace the submission boundary, first pending paint, server acceptance,
  YA echo emission/receipt, provider confirmation, pending removal **reason**,
  reducer action, durable response cursor/row IDs, and first projected/mounted
  user row. Preserve ID mappings across replacements. Server echo logs plus
  browser receipt logs distinguish missing emission from transport loss.
- Around recent submissions, record compact before/after membership and order
  for just those IDs and neighboring rows. Include follow intent, scroll-write
  reason, scrollTop/clientHeight/scrollHeight, visible render IDs, render-window
  bounds, trim revision, and target bounding rectangles. An unmounted row is
  not a missing row; a retained row outside the viewport is not visible.
- Keep a bounded recent-event ring; on a submission becoming absent from both
  pending and canonical state, or losing required order after durable catch-up,
  freeze/upload the pre-event ring plus a short post-event tail. A short
  submission-scoped check after acknowledgement/render can catch silent loss.
  Do not poll full transcripts/DOM indefinitely or log prompt/tool contents.
- Associate assistant output with a submission only when evidence supports it.
  In a busy steered turn, arbitrary assistant output after Enter need not be
  a response to that input; use it as a diagnostic trigger, not proof of
  acknowledgement or a hard failure by itself.

Routine verification before relying on capture: enable collection through its
existing control, make a harmless isolated send, and verify that server-side
logs actually contain its tab/session/temporary ID and the expected boundary
events. Repeat with delayed network and reload to check queue retention and
upload; verify no secrets/text leak and no per-token log flood. New anomaly
capture needs a deliberately induced missing-row/order failure that proves
the saved record contains the state from before the failure. A console message
alone, or an in-memory ring erased by reload, is insufficient.

If a live recurrence remains available, collect state before reloading and
compare it with a separately opened durable view. After reload, report the
lost browser evidence explicitly; successful JSONL reconstruction cannot clear
the live path. Do not restart the shared server for these probes.

## Closure

Keep the original visibility report open until a discriminating trace and a
real-browser regression explain and prevent it. The ordering fix does not
close this remaining visibility report. Logging suggestions remain proposals
until implemented and verified to preserve evidence across the reload that
hides the defect.

Found 2026-09-15 while investigating delivered user turns missing from their
sending window until reload. Contributing-model: 6-Astra
