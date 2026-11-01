# Provider architecture: T3 Code and the reduced YA core

Reviewed 2026-10-28. Status: source comparison and refactor recommendation,
not an approved implementation plan or a persistence migration decision.

## Recommendation

Make provider-session command ownership explicit, building on YA's existing
provider owner, host receipts and queues. Use addressed input/wake as the first
consumer of a bounded refactor, then apply the resulting boundary to queued
compaction. Keep provider-native history and YA-owned operational state as
separate responsibilities.

T3's useful example is the separation of command intent, provider execution,
normalized observation and durable application state. Adopting its entire
event-sourced thread model would be a much larger product and recovery project.
Effect is a separate implementation choice; it is not required to establish
these boundaries.

This recommendation advances the original goal: reliable queued `/compact`
followed by queued input. It does not make repairing individual adjacent gaps,
adding Antigravity, or another feature-removal campaign prerequisites.

## Evidence and scope

- **YA:** `05a131e9ae7b1a8c2c4305fc714d103ea753c307`, including the completed
  removal series through `bf292cf6b`. Same-host workers remain. Managed lanes,
  SSH executors, synthetic heartbeat automation, replay-message policy, dormant
  helper targets and unfinished aside report-back are removed.
- **T3:** fetched upstream `main` at
  [`c677d5fc45e6d585e52bca03244a0870c588a555`][t3-revision]. The local checkout
  at `~/github/t3code` remained at `28286d523f`; this review read current files
  with `git show origin/main:<path>`, rather than treating that older working
  tree as current source.
- Read implementation and architecture contracts for the paths below. No live
  provider, server-restart, persistence-replay or performance experiment was
  run. Statements about architectural costs and recommended boundaries are
  judgments from those sources, not measured reliability comparisons.

The [September overview](t3code.md) and
[October 3 remote-ownership report](t3code-remote-sessions.md) remain dated
background. This report refreshes the provider/control/persistence comparison,
not every feature or absence claim in those reports.

## The architectural difference

Both products directly integrate provider SDKs/protocols and normalize their
output. The difference is how far the application model extends beyond those
adapters, who owns operational decisions, and which state is authoritative.

| Responsibility | T3 at the reviewed revision | YA after the removals |
| --- | --- | --- |
| Application identity | Application threads/runs, provider-session/thread bindings and provider instances have separate identities. | YA-visible session IDs are distinct from native resume IDs. Project/session metadata bridges native storage and live owners. |
| Provider integration | Instance-scoped adapter opens a runtime with explicit operations and normalized events. | `AgentProvider.startSession` returns an `AgentSession`: iterator, input queue, abort and optional controls. |
| Command policy | Per-thread dispatch coordinates normalized commands, recorded effects and follow-up work. | Routes, app composition, Supervisor and Process each participate in admission, configuration, activation or delivery policy. |
| Execution owner | ProviderSessionManager owns adapter runtime scopes and event subscriptions. | ProviderSessionOwner/worker owns the real provider when hosted; Hono's Process observes through a proxy. In-process ownership remains supported. |
| Queued work | Application-owned queued runs and outbox effects are recorded in the orchestration model. | Process owns delivery intent and deferred/patient gates; the SDK/worker queue owns provider input. Separate queue persistence supports recovery. |
| Accepted application state | Event log, projections, command receipt and effects are committed transactionally. | Metadata, persisted queue records, host receipts and native history have separate stores and lifetimes. There is no equivalent unified orchestration transaction. |
| History | Application-owned normalized messages/items and projections, plus native bindings and snapshot operations. | Provider-native transcripts remain source material; YA metadata, recaps and local command rows are overlays/control records. |
| Restart | Durable intent supports reconciliation; lost live-provider work still requires explicit recovery policy. | Hosted ownership can survive Hono replacement. Host/process loss and queue recovery are different cases, with platform and runtime limits. |

Sources: T3 [architecture][t3-overview], [adapter contract][t3-adapter],
[manager][t3-manager], [event sink][t3-sink] and [recovery][t3-recovery];
YA [provider interfaces](../../packages/server/src/sdk/providers/types.ts),
[Supervisor](../../packages/server/src/supervisor/Supervisor.ts),
[Process](../../packages/server/src/supervisor/Process.ts) and
[provider-host contract](../../topics/provider-host-api.md).

## What T3 owns, and the cost of owning it

T3's event log is authoritative for its application orchestration state.
`EventSink.writeWithEffects` appends events, applies persisted projections,
enqueues effects and records the command receipt within a transaction.
Publication and effect-worker notification follow the commit. The effect
worker invokes provider start/control services and feeds outcomes back into
the application model. Acceptance therefore records intent; it does not assert
that provider execution or subsequent work has finished.
[EventSink][t3-sink] · [EffectWorker][t3-effects]

The adapter contract is substantial: `openSession`, `ensureThread`,
`resumeThread`, `startTurn`, optional `compactThread`, `steerTurn`,
`interruptTurn`, runtime-request responses, snapshots, rollback and forks.
Its events already speak the application's vocabulary: messages, provider
turns, execution nodes, runtime requests and related entities. This gives
orchestration a consistent model, while making each adapter responsible for
translating native behavior faithfully. [ProviderAdapter][t3-adapter]

That does not eliminate native provider state. The manager retains provider
bindings and runtime scopes; native continuation still needs the underlying
provider's resume facilities. A persisted application message is not itself
an executable native context. Recovery explicitly reconciles lost runtimes,
cancels stale work and retires effects whose callbacks cannot survive process
loss. An outbox does not make arbitrary shell or provider side effects
exactly-once. [Manager][t3-manager] · [Recovery][t3-recovery]

There are further costs:

- Stored events must remain decodable across upgrades and downgrades. Schema
  changes affect startup replay as well as network clients.
- App projections and native snapshots/bindings must agree sufficiently for
  continuation, forks and rollback. Owning the UI record does not remove
  provider reconciliation.
- A larger normalized vocabulary can expose many providers consistently, but
  can also require native escape hatches and provider-specific policy.

T3's documentation recommends keeping provider details behind adapters; its
actual orchestrator still has provider checks. For example, `goalDriverFor`
selects Codex/Claude drivers and nearby logic handles Claude `/goal` behavior.
It also explicitly rejects steering `/compact` into an active run. These are
useful reminders that a normalized interface and Effect do not automatically
produce a small, completely provider-independent orchestration layer.
[Provider constraints][t3-providers] · [Orchestrator][t3-orchestrator]

Effect supplies typed error/dependency channels and scoped resource ownership;
T3's adapter exposes those directly through Effect, Scope and Stream types.
That can help express lifecycle discipline, but it neither makes provider I/O
pure nor chooses the right persistence model. YA can first separate decisions
from effects in plain TypeScript. A framework adoption should justify its
migration cost against a concrete consumer after the ownership seam is clear.

## YA already has a provider boundary

The worker boundary is not a missing invention. In hosted mode,
`ProviderSessionOwner` owns the actual AgentSession, provider input queue,
approvals, controls and sequenced events. The socket adapter transports those
operations. Hono's Process is a controller/projection of that relationship,
not another native transcript writer.
[Owner](../../packages/server/src/sdk/providers/provider-session-owner.ts) ·
[Socket adapter](../../packages/server/src/sdk/providers/provider-runtime-socket-adapter.ts)

These are YA's owner guarantees, not proof that an external native TUI cannot
append to the same provider transcript. External-writer inference has its own
limitations; preserve conflict handling rather than treating a host receipt as
a native cross-process lock. See [session ownership](../../topics/session-ownership.md).

Host availability also matters: Linux defaults enabled, macOS defaults disabled
under the [active-turn interruption containment](../../gaps/macos-provider-host-turn-interruptions.md).
The supported source-Node host path is not universal across distributions and
runtimes. In-process ownership remains a real supported path, and Safe Reload
preserves existing workers without upgrading their loaded provider code.

The host also supports addressed auxiliary submissions, acceptance/status,
observation through a terminal record, and persisted receipts. Its HTTP
adapter explicitly rejects launch requests. This is valuable existing
machinery, but it is not a universal replacement for ordinary UI input:
auxiliary submission options, observation and retention semantics must not
silently become human-input, patient-queue or permission semantics.
[Host](../../scripts/provider-runtime-host.mjs) ·
[HTTP adapter](../../packages/server/src/routes/provider-host.ts)

The ownership seam is incomplete above it. In particular, low-level provider
input queueing and higher-level delivery intent are different responsibilities.
Process's deferred/patient queue is not merely an accidental duplicate of the
worker's SDK queue. Patient promotion also depends on verified idle, quiet
periods, retained work and compact-first gates. The refactor must give each
stage one authority without flattening those semantics into one generic FIFO.

### Current command paths

| Path | Current YA authority/coupling | Relevant T3 example and lesson |
| --- | --- | --- |
| Ordinary input | The message route records intent, handles native commands, resolves settings and calls Supervisor. Supervisor also prepares/discovers commands before Process delivery. | A normalized command is dispatched separately from provider execution. Centralize admission without moving HTTP/auth concerns into the provider. |
| Busy input | The route can defer directly through Process and await patient-queue persistence. Process distinguishes steering, turn-end and verified-idle delivery. | Queued runs are application state; steering is a separate operation. Preserve the distinction rather than copying T3's queue policy. |
| Addressed wake | The route authenticates/bounds input, SessionWakeService gates it, and the `app.ts` delivery closure resolves metadata/project and calls `Supervisor.resumeSession`, including for a live recipient. | Instance/runtime-owned addressing is a useful model. Graehl explicitly selected moving this capability to the provider API; the current Hono composition still owns the ladder. |
| Native compaction | AgentSession exposes `runProviderCommand`; shared dispatch is used by the message route and Supervisor. Resume compaction adds observation/admission policy. Restart compaction is separately extracted and still dispatches ordinary slash text. | Adapter runtime has optional `compactThread`; turn-start service selects native compact versus start. Keep operation identity explicit and completion separate from readiness for subsequent input. |
| Interrupt and approvals | AgentSession controls/callbacks are implemented by the live owner and forwarded when hosted; Process/Supervisor add application lifecycle policy. | Explicit control and runtime-request methods keep protocol mechanics in adapters. Owner loss still needs a defined outcome. |
| Resume/reconfigure | Supervisor and SessionActivationCoordinator resolve ownership, settings and restart/reattach. Native history and metadata supply continuation facts. | Manager/adapter split separates runtime ownership from native continuation. A database projection alone cannot substitute for a live or resumable native session. |

YA evidence:
[message route](../../packages/server/src/routes/sessions.ts),
[command dispatch](../../packages/server/src/supervisor/provider-command.ts),
[wake route](../../packages/server/src/routes/session-wake.ts),
[wake service](../../packages/server/src/services/SessionWakeService.ts),
[`app.ts` wake delivery closure](../../packages/server/src/app.ts),
[activation coordinator](../../packages/server/src/supervisor/SessionActivationCoordinator.ts),
[restart compaction](../../packages/server/src/supervisor/restart-compaction.ts).
T3 evidence: [orchestrator][t3-orchestrator],
[turn-start service][t3-start] and [turn-control service][t3-control].

### Persistence must be separated by purpose

YA already persists its own state; it is not simply a stateless log viewer.
SessionMetadataService stores YA metadata in SQLite. SessionQueuePersistenceService
stores versioned queue records separately in app-data JSON. The provider host
has its own receipts/recovery records. Native transcripts supply provider
history, with YA overlays merged for presentation.
[Metadata](../../packages/server/src/metadata/SessionMetadataService.ts) ·
[Queue persistence](../../packages/server/src/services/SessionQueuePersistenceService.ts) ·
[Host contract](../../topics/provider-host-api.md)

The recommended split is:

1. **Native conversation and resume state:** provider-owned, read through
   provider-specific readers/protocols. Preserve native-history interoperability.
2. **YA command intent and outcome:** explicit ownership of queue records,
   acceptance, cancellation and uncertainty; reuse the stores/receipts already
   serving those purposes before inventing another journal.
3. **Viewer state and enrichment:** YA-owned metadata, overlays and projections,
   without pretending they are native model context.

This is a recommended boundary, not a claim that today's separate stores have
atomic or uniform crash guarantees. A future plan must specify precisely what
is durable before acknowledging each operation. Moving everything to SQLite
would not, by itself, settle ownership, duplicate delivery or native effects.

## Recommended refactor sequence

### 1 — select the existing-owner input admission boundary

Plan a transport-independent admission path for input addressed to an existing
session owner. Ordinary input and wake are the two concrete consumers. Reuse
the owner/queue machinery rather than introducing a second runtime factory,
wake queue or general embeddable core package.

The first implementation should have an explicit, bounded outcome: both
consumers use the same selected admission authority for a live recipient,
including busy delivery, and the superseded policy branches are removed.
The implementation plan must choose where that authority lives across Process,
Supervisor and ProviderSessionOwner; this report does not settle that by naming
a new interface. Preserve human-versus-automatic intent and the existing
steer/deferred/patient choices.

Cold-recipient activation is a separate migration step. Keep its existing
behavior until the runtime owns project/identity resolution, eligibility and
launch facts needed to replace it. Cold-wake migration must not become a
prerequisite for the queued-compaction goal. A live-only slice must not claim
that wake delivery as a whole has become Hono-independent. Before implementation, trace
YA session ID to native host target explicitly: they are not interchangeable.

Acceptance evidence should exercise two real adapter shapes, Claude and Codex,
plus hosted and in-process ownership. Cover busy delivery, explicit rejection,
newer input beating speculative work, and loss after acceptance without a
second submission. Use controlled protocol fixtures rather than provider-name
wiring tests. Retain the existing host availability/platform limits.

### 2 — apply command ownership to queued compaction

Use the same admission/identity vocabulary for compaction and subsequent input,
with provider-specific native mechanics in adapters. Distinguish acceptance,
provider work, compaction completion, genuine readiness and terminal outcome.
Queue intent must outlive a provider rotation according to its durability
contract; a compact boundary alone must not authorize the next input.

Preserve current manual/native controls and threshold policy until a separate
decision changes them. Existing restart/resume differences are documented in
[plan 163](../tactical/163-http-independent-restart-compaction.md); this report
does not silently unify them. The adjacent
[Codex restart-dispatch gap](../../gaps/restart-compaction-codex-literal-text.md)
was recorded October 27 during static review, without a provider reproduction.
Keep it as evidence for a command-boundary test, not the architectural agenda.

### 3 — migrate eligible cold wake independently

Cold activation need not block the queued-compaction slice. Build on the same
boundary with the existing activation and resume-exemption machinery. Move the wake-specific delivery ladder out of Hono composition only
when the replacement owns it end to end. Preserve kill, archive, automation
pause, sandbox/account binding and sole-writer protections. Keep scoped sender
authorization at ingress; transport admission does not confer unrestricted
provider control. Keep the principal, credential, permitted operation and
transport distinct, following the existing
[principals and grants vocabulary](../../topics/principals-and-grants.md).
This is preservation of scope, not a new authorization protocol.

This implements the selected [wake ownership direction](../../topics/session-wake.md#selected-ownership-provider-api).
It does not add a scheduler, recurring prompts, remote SSH execution or a new
grant system. If activation cannot fit a bounded plan, defer that migration
without blocking the admission or queued-compaction work; document the
remaining boundary explicitly.

## Further removals and Graehl's feedback

The [decision table](../../topics/core-house-cleaning.md) remains authoritative.
The completed removals have already reduced the input-generation and execution
surface; another deletion campaign need not precede the ownership work.

| Surface | Recommendation and boundary |
| --- | --- |
| Conversation API/preview, row 10 | Strong next removal candidate: another application/client/API model. Inventory shared/native consumers before deleting its code generation, subscriptions and tests. Removal remains unselected for the next implementation slice. |
| Claude + Ollama, row 13 | Review separately for removal. Preserve the actively used Claude Gateway/Copilot workflow and shared Claude SDK integration. Personal non-use is not new deletion authorization. |
| Legacy Gemini, row 12 | Keep frozen unless it imposes meaningful refactor/qualification cost. Retained providers can exercise the boundary; preserve historical readability and useful regressions if execution is later removed. AGY is separate work. |
| Wake, recaps, `/btw`, Pi, Grok, provider host | Retain per revised feedback. Wake ownership changes; recap UI simplification and `/btw` tuning do not justify deleting their retained lifecycle support. |
| Keepalive | Retained with default-off/budget/accounting work still pending. Keep that policy task separate from provider command ownership; do not treat its new safeguards as already shipped. |
| Broader automatic compaction, row 16 | Further removal needs a scope decision. Retirement of the Spark plan does not authorize deleting manual/native controls or current thresholds. |
| Boss/yacron/federation/general core proposals | Remain deferred. Deleting proposal documents would not simplify running provider code. |

## Decisions for the next implementation plan

Select a small plan for live-recipient input admission, not a full event-sourced
rewrite. It must identify the exact policy branches to move/remove, the sole
owner at each queue stage, accepted-versus-uncertain outcomes, and the existing
stores/receipts that back those claims. Confirm the scope of cold activation
and the unchanged host/in-process support matrix before implementation.

Defer canonical YA-owned conversation storage, a wholesale event vocabulary,
Effect adoption, public core packaging and remote execution placement. Those
choices can be revisited for concrete consumers; none is necessary to make the
next provider boundary cleaner. Reopen the relevant dormant route/module
ledger deliberately if the selected implementation touches those campaigns.

## Pinned T3 sources

All upstream links below refer to the same reviewed revision. Function names
in the analysis are search handles rather than assumptions about future paths.

[t3-revision]: https://github.com/pingdotgg/t3code/tree/c677d5fc45e6d585e52bca03244a0870c588a555
[t3-overview]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/docs/internals/overview.md
[t3-providers]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/docs/internals/providers.md
[t3-adapter]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/packages/provider-core/src/server/ProviderAdapter.ts
[t3-manager]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/apps/server/src/orchestration-v2/ProviderSessionManager.ts
[t3-sink]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/apps/server/src/orchestration-v2/EventSink.ts
[t3-effects]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/apps/server/src/orchestration-v2/EffectWorker.ts
[t3-recovery]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts
[t3-orchestrator]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/apps/server/src/orchestration-v2/Orchestrator.ts
[t3-start]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/apps/server/src/orchestration-v2/ProviderTurnStartService.ts
[t3-control]: https://github.com/pingdotgg/t3code/blob/c677d5fc45e6d585e52bca03244a0870c588a555/apps/server/src/orchestration-v2/ProviderTurnControlService.ts
