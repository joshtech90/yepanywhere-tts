# YA vs pi-durable Sketches

> Candidate designs that borrow pi-durable's "one observable state value per
> conversation" idea for the session facts YA owns, without YA taking over the
> provider loop.

Companion to: [ya-vs-pi-durable](ya-vs-pi-durable.md)

Status: candidate design only. Nothing here is implemented, enabled by a
setting, or authorization to implement.

Related topics: [Simple Client API](simple-client-api.md),
[provider state machine](provider-state-machine.md),
[session liveness](session-liveness.md),
[queued messages](queued-messages.md),
[provider child sessions](provider-child-sessions.md),
[provider fork support](provider-fork-support.md),
[provider host API](provider-host-api.md),
[core service API](core-service-api.md),
[server capabilities](server-capabilities.md),
[architecture mandates](architecture-mandates.md).

## Session state and subscription layer

### Problem

A client learns a session's live state from several channels that each carry
part of it. The `session` subscription sends a `connected` snapshot followed by
`status`, `heartbeat`, `deferred-queue`, `mode-change` and other events. The
`activity` channel forwards `BusEvent`s such as `process-state-changed` and
`queue-request-added`. REST reads (`/sessions/:id/process`,
`/sessions/:id/pending-input`, metadata) fill gaps. Each fact has its own
delivery path and no shared revision, so
[provider state machine](provider-state-machine.md) needs event-versus-snapshot
freshness rules, heartbeat repeats of `processState`, and
advisory-until-reconciled queue indicators to repair races. Every consumer
repeats that work: the web session-detail code, Android, the Simple Client
Conversation (which carries "current session state and pending requests"),
Project Queue's idle predicate (`getProjectWorkIdleStatus`), session wake and
agentctl-style automation.

pi-durable avoids this by making every observable fact part of one committed
value per conversation and delivering one operation batch per commit. YA cannot
copy the transcript half of that design (see
[the crux](ya-vs-pi-durable.md#the-crux-who-owns-the-loop)). It can copy the
state half for the facts YA itself owns or derives.

### Shape

One server-owned `SessionState` value per live session, containing only
YA-owned or YA-derived facts and kept small enough to resend whole:

| Section | Contents | Current source |
|---|---|---|
| `identity` | YA session ID, provider, model, provider resume handle when exposable | `ProcessInfo`, session metadata |
| `ownership` | `none` / `self` (process ID, permission mode and version) / `external` | `SessionOwnership` |
| `run` | `idle` / `in-turn` / `waiting-input`, `since`, compacting flag, and the YA-dispatched turn awaiting settlement | `ProcessState`, `isCompacting` |
| `pending` | Open approvals, questions and choices, each with a stable request ID | `InputRequest` map on `Process` |
| `queue` | Queued, deferred and patient entries with mode and status | `SessionQueuedMessageSummary`, `deferredQueue` |
| `nextTurn` | Pending effort/model/mode selections applied at the next idle boundary | per-provider next-turn effort contract |
| `liveness` | Derived status and evidence timestamps, advisory only | `SessionLivenessSnapshot` |
| `runtime` | Retry/failure state reported by the provider | `ProviderRuntimeStatus` |
| `usage` | Context and token accounting where the provider reports it | existing usage fields |
| `related` | Optional, provider-reported; see the next section | provider readers and SDK events |

Not in it: transcript content, streaming partial text and tool output. Those
stay on the existing session stream and the Simple Client Conversation,
because they are high-rate and the provider owns their durability. A coarse
`activity` summary (current tool name and start time, throttled) is a
candidate addition if clients need it without subscribing to the stream.

Delivery:

- Subscribing returns `snapshot { binding, epoch, revision, value }`, then
  `update { binding, revision, sections }` in revision order. An update
  replaces whole top-level sections. Because the value excludes the
  transcript, section replacement should be cheap enough that YA needs no
  general patch format or Chord-like operation library. Measure before
  adding JSON Patch.
- One revision per batch of state changes, coalesced to at most one update per
  event-loop turn, analogous to pi's one batch per commit.
- A slow consumer keeps a bounded number of pending updates; on overflow the
  pending updates are replaced by a fresh snapshot. Reconnect starts from a
  snapshot; there is no replay.
- `epoch` identifies the producer lifetime. Revisions are in memory, so a new
  epoch tells a client that it must discard its state, as after a server
  restart. If the producer lives in the provider host, its epoch can survive
  Hono reloads.
- A one-shot read returns the same snapshot shape.
- It rides the existing WebSocket/relay `subscribe` framing and binding
  mechanics, using the Simple Client API's binding ID and sequence rules.

Contract: a consumer of `SessionState` never derives these facts from the
other channels. The old events remain for existing clients.

### Actions as submissions

YA-owned actions (send, queue, cancel queued, steer, approve, answer, set
next-turn configuration, interrupt) take a client-generated `requestId`. The
server deduplicates per session over a bounded window and reports settlement
in the state value: an action is `accepted`, then `done` or
`unanswered { reason }`. This replaces `tempId` echo matching for YA's own
queue and approval paths. Settlement means YA delivered the action or decided
it; for sends, the provider transcript later confirms the user turn as it does
today. The provider host's `sessionTurn` `submissionId` is the existing
precedent.

### Derived events

Automation wants transitions, not values. A thin adapter derives events from
successive `SessionState` revisions, for example `turn-settled`,
`input-requested`, `queue-changed` and `became-verified-idle`. It owns no
persistence, the same stance as pi's `watchEvents()`. Like pi, it is
convergent: after an overflow it emits a snapshot, so a consumer that must
not miss a transition still checks state.

### Harness-agnostic boundary: forks and subagents

YA is harness-agnostic, so the core value does not model fork or subagent
lifecycle. YA cannot abort, await, replay or idle-gate a provider's subagent the
way pi's task ownership does, and providers expose children inconsistently.

`related` is therefore optional and descriptive:

- Present only for providers with an implemented adapter. Providers report
  children and fork lineage from session persistence (Claude `subagents/`,
  Codex `spawn_agent` rollouts, pi `parentId` trees) or from harness SDK events
  where an SDK exposes them.
- Each entry records its source (`persistence` or `sdk`) and coverage
  (`complete`, `partial` or `unknown`). An absent section means unknown, never
  "no children".
- Child identity follows [provider child sessions](provider-child-sessions.md):
  provider-native child IDs never become YA session IDs.
- The only action is navigation to the child's view. Control of a child stays
  with the provider's own tools.
- Relationships YA itself creates (`/btw` asides, YA-initiated forks,
  cross-host delegated sessions) are YA facts and can be reported as complete.

A provider capability, derived like `supportsForkSession` from whether the
adapter exists, tells clients whether `related` can appear.

### Server scope, later

A sibling server-level value could list live sessions with their `run`,
`pending` count and attention state, the YA analog of pi's `SessionDirectory`
service plus its task-graph view. Its consumers would be the sidebar, Agents
page and Project Queue. It is out of scope for a first slice; the Simple Client
API's SourceOverview review owns that family.

### Compatibility and staging

The layer is additive: an `/api/experimental/` operation with an optional
capability, reviewed under
[server capabilities](server-capabilities.md#minimum-compatibility-horizons).
Older servers keep today's channels, and clients fall back to them.

1. Schema from existing types; producer in Hono derived from `Process`,
   liveness and queue services. No new persistence.
2. Subscription and one-shot read over the existing `subscribe` framing, with
   coalescing, overflow-to-snapshot and teardown on last consumer, per
   [architecture mandates](architecture-mandates.md).
3. First consumer: the Simple Client preview's pending-request and
   session-status display, replacing its copy of that state.
4. Second consumer: Project Queue's idle predicate, comparing decisions with
   the current predicate before switching.
5. Submissions with `requestId` for queue and approval actions.
6. `related` for one provider with a reader that already lists children.
7. Decide whether the producer moves into the provider host.

### Open questions

- Should pending approvals and questions survive a Hono restart? They are
  in-memory on `Process` today; with the provider host, the worker owns the
  callback, so the host may be the right owner.
- Does whole-section replacement stay cheap once `queue` holds many patient
  entries with long text? If not, ship queue text by reference.
- Should `liveness` be in the value, or on its own slower channel so heartbeat
  churn does not advance the revision every 30 s?
- Does the Simple Client Conversation drop its copy of session status and
  pending requests in favor of this value, or embed the same section?
