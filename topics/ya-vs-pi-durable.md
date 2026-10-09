# YA vs pi-durable

> pi-durable is pi's experimental durable agent harness: it owns the model loop,
> commits every observable fact (transcript entries, in-flight partials, tool
> output, queue, run control) before showing it, and lets UIs watch one
> structural value per conversation; YA supervises vendor harnesses whose
> native transcripts are authoritative, so its live state is assembled from
> events, snapshots and reconciliation rules, and it cannot make forks or
> subagents first-class parts of its own model.

Topic: ya-vs-pi-durable

Companion: [`ya-vs-pi-durable.sketches.md`](ya-vs-pi-durable.sketches.md)
proposes a YA session-state and subscription layer informed by this
comparison.

Related: [pi provider](pi-provider.md) (how YA drives pi today, and periodic
pi tracking), [Simple Client API](simple-client-api.md),
[provider state machine](provider-state-machine.md),
[session liveness](session-liveness.md),
[queued messages](queued-messages.md),
[stream/persisted render convergence](stream-persisted-render-parity.md),
[provider child sessions](provider-child-sessions.md),
[provider fork support](provider-fork-support.md),
[provider host API](provider-host-api.md),
[core service API](core-service-api.md).

## Source pin

Compared against `earendil-works/pi` at `98d2e1947aa9` (2026-10-05),
`@earendil-works/pi-durable` 1.0.3: `packages/durable/README.md`, the normative
`packages/durable/docs/spec.md` ("Pico5"), and
`docs/pico-v5-chord-usage.md`. The README marks the package experimental with
API changes between releases. Recheck before relying on a detail below.

## The crux: who owns the loop

pi-durable calls model APIs itself through `pi-ai` and runs tools as its own
durable tasks. Because no model request or tool effect happens outside its
scheduler, it can make "only committed state is observable" an invariant: a
partial answer, a tool's running output, a queued steer and the busy flag all
exist only as committed documents.

YA does not own the loop. It drives Claude Code (SDK), Codex (app-server),
OpenCode, pi (`pi --mode rpc`) and others, and the provider writes the durable
transcript. YA observes provider output after the fact and keeps provider
persistence as the transcript authority; it deliberately keeps no shadow
transcript.

This is a product constraint, not an unfinished refactor. pi reaches models
through API keys and subscription logins that `pi-ai` implements itself; for
OpenAI that includes Sign in with ChatGPT and the legacy ChatGPT Codex
endpoint, so pi can run its own loop against a ChatGPT subscription. Anthropic
is different: pi can sign in with a Claude Pro/Max account, but since pi 0.66.0
its interactive mode warns that Anthropic bills third-party use as per-token
extra usage. In practice pi's Anthropic usage is token-billed, and a Claude
plan's included usage is reachable only through Anthropic's own harness, which
YA drives through the Claude Code SDK. YA's users depend on that, so YA keeps
Claude Code and Codex as the executing harnesses and accepts the consequences:

- YA cannot commit before the provider shows. In-flight provider content is
  observed, not owned, and its durability is whatever the provider persists.
- Subagents, forks, compaction and retries are provider decisions. YA sees
  them through provider persistence (Claude subagent JSONL, Codex child
  threads, pi's `id`/`parentId` tree) or harness-specific SDK events, with
  provider-specific fidelity and timing.
- YA does not micromanage turns. pi-durable can hook `beforeRequest`,
  `beforeTool`, `onYield` and compaction placement; YA can only use controls
  each harness exposes (steer lanes, interrupt, approval callbacks, effort).

## pi-durable in brief

The README describes the public model; the spec is normative. Load-bearing
points for this comparison:

- **One mutation line per Session.** Every change is an atomic commit of
  immutable entries, task records, submissions and Chord-tracked JSON
  documents. "A document update is published only after its storage commit
  succeeds" and "there is no volatile publication path" (spec § 1). Storage
  is memory, SQLite or JSONL; one process owns a storage, with no cross-process
  locking.
- **Built-in documents carry live state.** `pi.live` holds run control
  (`run` present exactly while busy), the in-flight generation (throttled
  partial message, retry backoff, deferred poll), tool slots with running
  output and details, and live compactions. `pi.inbox` holds queued steers,
  follow-ups and passive writes. `pi.agent` holds per-conversation choices
  (model, thinking, extensions, tools, instructions, cwd). `pi.provider` holds a
  provider-facing UUIDv7 used for prompt-cache affinity; `pi.usage` holds spend.
  Partials and tool output commit at most every 100 ms by default, so a crash
  loses at most that window.
- **Submissions are durable requests.** `submit()` returns after durable
  admission. An input settles `done` with its answer entry or `unanswered`
  with a reason (`aborted`, `stale`, `reset`, run failure). A `requestId`
  makes a retried submit exactly-once per conversation. `whenBusy` selects
  `followUp` (default), `steer` or `reject`; steers are placed after the
  current tool round and follow-ups at the end of the run.
- **Tasks are durable state machines.** Generation, each tool call and each
  compaction are tasks that checkpoint every phase. Tasks and conversations
  have explicit owners; aborting an owner aborts owned work bottom-up, and an
  owner is idle only when its owned work is. A tool declared
  `replay: "safe"` reruns after a crash; otherwise the model gets an
  `interrupted` result.
- **Conversations, forks and subagents are first-class.** A fork names an
  entry and copies documents according to each document's fork policy
  (`asOf`, `current`, `initial`); it gets a fresh provider identity. A
  subagent is a conversation owned by a tool's task; a UI finds it through the
  tool's `details`, `ConversationRecord.owner`, or the task graph.
- **Observation is convergent, not an audit log.** `viewState()` and
  `watch()` expose one structural `ConversationView` (raw active entries plus
  the built-in documents), updated by exactly one Chord operation batch per
  commit that touches it. `watchEvents()` (experimental) derives coding-agent
  style events (`message_update` deltas, `tool_execution_*`, `run_start`,
  `submission`, `inbox_update`, …) from the same commits. Every watch buffers
  at most 100 undelivered frames, then replaces them with one full value or
  `snapshot`. Reconnect means attaching again and starting from the current
  value; nothing is replayed. `taskGraph()` shows every live task and the
  conversations it owns.

pi is building a YA-like server on top of this, also experimental
(`packages/server`, `packages/client`,
`packages/coding-agent/src/experimental`). A server routes client
presentation attachments to per-Session workers; each worker locks one
`session.sqlite`, opens the Harness, and serves Chord services such as
`Transcript` (the root conversation's `viewState()` as replicated state) and
`AgentController` (prompt, steer, follow-up, cancel queued, abort, compact,
wait for a prompt's answer). Chord replicas own hydration, sequencing and gap
detection, and the worker keeps no reducer of its own. A worker stays alive
while its task graph has live tasks. This overlaps YA's supervisor role for
pi-only sessions and belongs in the periodic tracking list in
[pi provider](pi-provider.md#what-to-track-periodic).

## Comparison

| Axis | pi-durable | YA |
|---|---|---|
| Transcript authority | Its own Session storage | Provider-native transcript files and databases |
| In-flight content | Committed throttled partial in `pi.live` | Live provider stream through `Process`, replay buffer and streaming-text catch-up; durable only once the provider persists |
| Busy/idle | `pi.live.run` present ⇔ busy, by definition | `processState` plus `sessionLiveness.derivedStatus`; `verified-idle` is the only safe automation boundary |
| State delivery | One structural value per conversation; one op batch per commit | `Process` state, pending `InputRequest`s, queues, ownership and liveness reach clients as `session`-channel events (`connected`, `status`, `heartbeat`, `deferred-queue`, …), `activity`-channel `BusEvent`s, and REST reads (`/process`, `/pending-input`, metadata), reconciled by event-versus-snapshot freshness rules |
| Late join / reconnect | Fresh snapshot; no replay | `session` subscription sends a `connected` snapshot, replays the `Process` message buffer (about 15–30 s) and streaming-text catch-up; older content comes from the provider transcript over REST. A resubscribe's `lastEventId` skips buffered messages the client already received within the same `Process`. Works only while a live `Process` exists |
| Backpressure | 100 frames, then full replacement | No per-client outbound buffer; Simple Client SSE keeps one queued frame and one pending replacement |
| Input queue | Durable `pi.inbox`; steer/follow-up placement rules are part of the spec | Server-authoritative queue: patient entries durable, direct/deferred entries process-local; delivery lanes differ per provider |
| Request identity | `requestId` exactly-once; `done`/`unanswered` settlement | `tempId` echo matching; queue indicators advisory until reconciled. The provider host's `sessionTurn` has an idempotent `submissionId` and cursors, but only between Hono and a worker |
| Subagents | Owned conversations; abort and idle cascade through ownership | Provider child sessions discovered from provider persistence, shown under the canonical parent |
| Fork | Entry-anchored, with per-document fork policy | `forkSession` for Claude, Codex and pi; provider session tree is capability-gated |
| Compaction | Harness task; summary placed as a head write; staleness ordered by cut | Provider-owned; YA observes compaction status and boundaries |
| Crash recovery | Reopen storage; tasks resume from checkpoints | Provider host keeps workers across Hono reloads and replays unacknowledged sequenced worker events (bounded); a worker or host crash falls back to provider resume |
| Extension | Extensions with tools, prompt sections, hooks, wraps and tasks | YA-owned features around the provider (queue, `/btw`, bang commands, display objects); per-harness controls only |

## What transfers to YA

The parts of pi-durable's design that do not depend on owning the loop:

1. **One state value per session for YA-owned facts.** YA's run state,
   ownership, pending requests, queue and next-turn configuration reach
   clients as independent events and snapshots, so
   [provider state machine](provider-state-machine.md) needs freshness rules
   and heartbeat repeats to undo races. A single versioned structural value,
   delivered as snapshot plus ordered patches, removes that class of race for
   the facts YA owns.
2. **Busy as a defined field rather than an inference** where YA can define
   it: a YA-dispatched turn is outstanding until its settling evidence
   arrives. Provider liveness stays separate and advisory.
3. **Submissions with idempotent request IDs and explicit settlement**, in
   place of `tempId` echo matching, for YA-owned actions: send, queue, cancel,
   approve and answer.
4. **Convergent delivery with full-value recovery.** Bounded buffers, overflow
   to snapshot, and reconnect-from-current are already the Simple Client API's
   direction. pi-durable shows the same rule working for live state, not only
   for a transcript window.
5. **Derived events as an adapter, not a second authority.** pi's
   `watchEvents()` derives events from committed state changes and owns no
   persistence. YA automation consumers (Project Queue's idle predicate,
   session wake, agentctl, ask-session) could consume derived events from a
   state value instead of each reading raw signals.

What does not transfer:

- **Committing provider partials.** YA would be building the shadow
  transcript that [stream/persisted render
  convergence](stream-persisted-render-parity.md) rejects, without gaining
  pi's crash semantics, because the provider still owns the turn.
- **Structured concurrency over subagents and forks.** YA cannot abort,
  await or replay a provider's subagent through its own task graph. It can
  show what a provider reports, marked with the provider's coverage.
- **Hooks into the request and tool path.** Each harness exposes a different
  and narrower control surface.
- **Chord as a dependency.** Under YA's minimal-runtime rule, a hand-rolled
  JSON patch subset under standard names is the likely shape; see the
  companion sketch.

## pi as a YA provider

YA's pi provider drives the stable coding agent through `pi --mode rpc` and
reads `~/.pi/agent/sessions` JSONL; it does not touch pi-durable. pi-durable
sessions live in separate SQLite storage owned by one process at a time, so
reading them directly while a worker runs is unsupported. A future pi-durable
provider would more naturally attach as a client of pi's server `Transcript`
and `AgentController` services, or embed a Harness, than read its storage.
`watchEvents()` mirrors the coding agent's `AgentSessionEvent` names, which
suggests YA's existing pi normalization would map with modest change.
<!-- assumed --> Neither path is planned; revisit when pi's durable agent
leaves `experimental/`.
