# Client Stream Dispatch Coalescing

> Live session stream events are coalesced before they reach React state:
> immediate while the stream is quiet, batched into one task per adaptive gap
> under a burst, so a replay or a busy turn on a large transcript cannot
> commit once per event and trip React's nested-update limit.

Topic: client-stream-dispatch-coalescing

See also: [`packages/client/RENDERING_PERFORMANCE.md`](../packages/client/RENDERING_PERFORMANCE.md)
(the render pipeline's coalesced-versus-immediate rules; this topic is the
entry-point half of that contract),
[session liveness](session-liveness.md) (the freshness state fed by these
events), and `docs/project/server-message-routing.md` § Late-join replay (the
server-side burst source).

## Contract

`useSession` hands every live session stream event — `message`, `status`,
`deferred-queue`, `markdown-augment`, `connected`, and the rest — to a
`createStreamDispatchCoalescer` instance (`packages/client/src/lib/streamDispatchCoalescer.ts`)
instead of processing it in the transport callback:

- **Quiet stream, immediate dispatch.** An event arriving at least `gapMs`
  after the previous dispatch is processed synchronously in the transport
  callback, so user echoes, queue acknowledgements, status, and approvals keep
  their light-load latency.
- **Inside the gap, one batch per gap.** Later events queue in arrival order
  and drain together in one timer task at the end of the gap. Whatever React
  work they produce commits together. Order is never reordered across the
  immediate/queued boundary.
- **Adaptive gap.** `gapMs` starts at 32 ms. A flush whose timer fires more
  than one gap late (the main thread was busy rendering) doubles the gap, up to
  400 ms; a flush that fires on time shrinks it by a quarter, down to 32 ms.
  Timer lateness is the pressure signal because it is what the stalled tab
  actually exhibits, and it needs no per-commit instrumentation.
- **Lifecycle.** Disposing drops queued events and cancels the flush; the
  hook disposes on unmount and on a session-id change. A dispatch that throws
  does not wedge later events.
- **Downstream throttles are unchanged.** Token deltas still go through the
  streaming-content throttle and freshness state through its 500 ms
  coalescer; this layer only bounds how many tasks carry events into them.

Tests must treat two events emitted at the same fake instant as one batch:
`useSession.test.ts` settles the pending flush with `settleStreamDispatch`.

## Why: the "frozen, then blank" tab

Observed on the hosted client and on localhost: a tab stops responding for one
to several seconds, and sometimes goes blank until reload. Client logs carried
React error #185 ("Maximum update depth exceeded") 55 times on 2026-09-10, 4 on
2026-09-13, and 4 on 2026-09-14, each thrown from a stream-event `setState` in
`useSession`. The named `setState` is a bystander: React 19 throws it from
whichever update follows the limit. `commitRoot` counts a "nested update" for
every commit that leaves Sync, InputContinuous, or Default lane work pending
(`nestedUpdateCount` in `react-dom-client`), and resets only when a commit
leaves none. No effect loop is required: a stream that delivers events faster
than the page commits keeps every commit's successor pending, and after 50 in a
row the next `setState` throws. When that throw lands in an event handler it
is an unhandled rejection and the tab recovers; when it lands inside a commit
the error boundary tears the app shell down — the blank page.

Reproduced 2026-09-18 in the real client (Playwright, isolated server, one
websocket event every 4 ms into a 60-row self-owned session):

| Event mix | Frame probes | React #185 |
| --- | --- | --- |
| text deltas only | 15–20 ms each | 0 |
| non-delta messages only | 120 ms, 600 ms, 1.8 s, then a 5 s stall | 24 |

Deltas were already throttled by `useStreamingContent`; every non-delta message
(`system`, `user`, `assistant`, status) was one store write plus one immediate
freshness `setState`, so one commit each. The late-join replay the server sends
on every subscribe (15–30 s of events in one burst) produced exactly that shape
after switching back to a live session, which is why the freeze clustered
around sidebar session switching.

## Non-goals

This does not make a slow transcript render fast, and it does not change what
the server replays. It bounds the number of React commits an arrival burst can
force so the client degrades to fewer, larger commits instead of a stall
followed by a crash.
