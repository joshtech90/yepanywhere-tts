# A passed-over session keeps loading, replaying, and rendering after the user moves on

Switching sessions in the sidebar faster than a large transcript renders,
with DOM linger and the transcript memory cache enabled, makes the client do
the full arrival work for every session the user only passed through. Each
passed-over session costs:

- its session-detail load, which `useSessionMessages` never aborts on unmount
  (no `AbortController` in that hook), so the fetch completes and its
  projection lands in the store after the user has left;
- its late-join stream replay (15–30 s of events on every subscribe,
  `docs/project/server-message-routing.md` § Late-join replay), now
  coalesced by `createStreamDispatchCoalescer` but still fully processed;
- its transcript render, which continues for
  `SESSION_DOM_LINGER_RESOURCE_TRANSITION_DELAY_MS` (500 ms plus a frame)
  after the layer is parked before `SessionDomLingerLayer` commits the
  paused subtree, and which a parked-then-evicted layer throws away.

Because each of these is main-thread work in the same tab, a run of quick
switches stacks the passed-over sessions' work ahead of the session the user
actually stopped on. The stream-flood crash that used to follow is fixed
(`topics/client-stream-dispatch-coalescing.md`), but the stacked cost remains
and reads as "large transcripts are slow to switch to".

Cheap fix if known: treat a session the user did not linger on as abandoned.
On unmount or park before its first committed transcript, abort the detail
load, discard the partial store entry instead of retaining it under the cache
budget, and skip the parked-render grace period. A session becomes worth
caching only once the user has stayed long enough for its first render to
commit; keeping the cache is the user's explicit choice
(`yep-anywhere-session-transcript-cache-budget-mb`), and this only changes
what enters it. Verify with the sidebar-switch harness from
`packages/client/e2e/session-stream-flood.spec.ts` extended to three quick
switches, measuring time-to-interactive on the last session.

Found 2026-09-18 while root-causing the frozen-then-blank tab after sidebar
session switches.
