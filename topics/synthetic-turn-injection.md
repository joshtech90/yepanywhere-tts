# Synthetic-turn injection

Topic: synthetic-turn-injection

Status: implemented for ordered user/assistant text through the conversation
context route. Codex supports native history insertion; other providers use an
attributed normal user turn. Fork-after-summary has not adopted this route.
The historical research below explains the role-preservation motivation.

See also:
[fork-from-turn](fork-from-turn.md) (the consumer: fork-after-summary submits a
single synthetic user turn today),
[recaps](recaps.md) (the summary facility that generates the collapsed text),
[session-context-actions](session-context-actions.md) (handoff posture this
would extend),
[provider-abstraction](provider-abstraction.md) (where a cross-provider inject
capability would live),
[compact-and-handoff](compact-and-handoff.md) (the adjacent compaction path that
also reshapes transcript history).

## Conversation-context delivery contract

`POST /api/projects/:projectId/sessions/:sessionId/conversation-context` accepts
`{ requestId, turns: [{ role: "user" | "assistant", text }] }`. It is a general
sequence-of-turns surface, with no required aside handle or question/answer
shape. Callers supply any provenance as ordinary context text. System roles,
tool blocks, and opaque reasoning are outside this text-only contract.

The existing session must have a matching live YA process owner; callers can
use the existing reactivate route first. A missing owner or wrong project
returns 409. The request ID is 1–128 word/hyphen characters, the sequence has
1–64 turns, and combined text is at most 262144 UTF-16 code units. Invalid JSON
or shape returns 400. The route uses the ordinary authenticated API boundary.

The owner invokes optional `AgentSession.appendConversationContext(turns)`:

- `true` returns `{ delivery: "native-history" }`. Role and text are preserved.
  Codex maps messages to input/output text items in `thread/inject_items`,
  through the incumbent local, provider-host, or managed-SSH session. It does
  not start a new turn or steer existing work. Idle injection records and
  flushes history; active injection queues context for the running harness.
  The receipt means accepted, not proof the model has already consumed it.
- An absent method or explicit `false` selects the existing normal message
  queue with a role-attributed envelope, returning `{ delivery: "user-turn" }`.
  The envelope identifies supplied assistant text and already-answered
  questions. This delivery follows normal session semantics and may cause a
  reply. Unsupported native insertion is never a successful no-op.
- Provider errors return 502. Only explicit unsupported-method failure
  (Codex JSON-RPC -32601) selects fallback; other failures must not silently
  send a second copy through another mechanism.

Request receipts are scoped to the lifetime of the YA process owner. Concurrent
or repeated identical IDs and payloads join the same operation; changed content
under the same ID returns 409. Failed receipts are retained because acceptance
may be uncertain. Each owner retains at most 256 receipt fingerprints, then
rejects new IDs with 429. This is not durable idempotency across server restart
or process replacement. The question-card client prevents duplicate Save and
does not automatically retry uncertain failures.

The permanent, version-implied `session-conversation-context` capability
(ID 57, introducing release 0.8.2) gates only this route. Without it, clients
can format the same attributed envelope and submit it as an ordinary user
turn using existing routes. Existing fork support remains independently usable.
The optional-feature review on 2026-09-06 inspected stable v0.8.0 and v0.8.1,
the latest two and all stable releases in the preceding 14 days; neither
provides this route. Their capability meanings and delivery paths are unchanged.

Initial consumer: [one-shot question cards](provider-agnostic-btw-asides.md).
That caller saves the actual question and subsequent assistant text, including
fork provenance and the fact that main continued independently. This operation
does not merge branches, replay tools, rewrite earlier turns, or itself grant
authority to act on imported text.

## Why this exists

Fork-after-summary collapses N source turns into **one** synthetic *user* turn
(`fork-from-turn.md` step 5; template contract there). That loses two things:

- **User-vs-agent authorization provenance** — a flat user turn cannot show
  "user authorized X · agent did Y–Z autonomously · user confirmed W." For a
  long autonomous `/loop` run, most of the compressed turns were agent-driven,
  and the receiver cannot see where the human actually greenlit.
- **Liveness honesty** — present-tense claims ("job in flight", "loop active")
  in the flattened prose float free of any real turn boundary.

There are two strengths of fix, and only the second needs this topic:

1. **Attributed content in one real user turn** (header + explicit attribution
   markers). No provider support required; covers the audit need. This is the
   recommended default and is tracked in `fork-from-turn.md`.
2. **Genuine synthetic alternation** — inject multiple user+assistant turns the
   target *model* replays as its own history. This doc is about whether the
   providers actually allow (2), and at what fidelity.

## Core question

Can a provider accept a **sequence** of synthetic user+assistant turns, with
fabricated ids and no server round-trip, as resumable model-visible history?

## Codex arm — first-class support

Verified by reading the inspected Codex source (`~/ya/.local-checkouts/
openai-codex-inspect` @ `251b241`, 2026-05-29; Codex CLI ~0.125.0 context per
`packages/server/src/sdk/providers/codex-turn-lifecycle-findings.md`). Codex's
rollout model makes synthetic alternation a supported operation, not surgery:

- **`InitialHistory::Forked(Vec<RolloutItem>)`** (`codex-rs/protocol/src/
  protocol.rs:2337`; variants `New | Resumed(ResumedHistory) | Forked(...)`). A
  thread can be started from an arbitrary vector of rollout items. Exercised in
  `core/src/thread_manager_tests.rs` with hand-built items, e.g.
  `InitialHistory::Forked(vec![RolloutItem::ResponseItem(user_msg("hello"))])`.
- **Live injection without a new turn** (`core/src/codex_thread.rs`):
  - `inject_response_items(Vec<ResponseItem>)` — "Record raw Responses API
    items without starting a new turn."
  - `inject_user_message_without_turn(String)` — "Records a user-role
    session-prefix message without creating a new user turn boundary."
- **Synthetic turn shape** (`external-agent-sessions/src/export.rs`):
  `ResponseItem::Message { id: None, role: "user"|"assistant",
  content: [InputText|OutputText] }`. `id: None` ⇒ **no server-assigned response
  id is required**. Each turn also emits paired `EventMsg`
  (`TurnStarted`/`UserMessage`/`AgentMessage`) carrying the UI/event view;
  `ResponseItem` is the model-visible unit (the synthesized `TokenCountEvent`
  counts only `ResponseItem::Message` content).
- **Fabricated turn ids are fine**: imported turns use
  `format!("external-import-turn-{n}")` — directly answers "without
  harness-registered uuids": Codex tolerates synthetic deterministic turn ids.
- **Tool calls are flattened to text**: the official importer collapses
  `tool_use`/`tool_result` into plain assistant `OutputText`
  (`records.rs`: a content block that is only a tool result maps to
  `MessageRole::Assistant` text). It does **not** reconstruct
  `FunctionCall`/`FunctionCallOutput` items. The safe synthetic form is
  text-only.
- **Provenance marker is an existing convention**: the importer appends an
  in-band `<EXTERNAL SESSION IMPORTED>` `AgentMessage`. Codex already marks
  synthetic/imported content in-band — direct precedent for an honest
  fork-after-summary boundary marker.

`external-agent-sessions` exists precisely to ingest a *foreign* agent session
(e.g. a Claude jsonl) as Codex rollout items — i.e. synthetic-turn injection is
already a shipped Codex feature, just aimed at whole-session migration.

**Resolved 2026-09-06:** official `rust-v0.153.3`, commit
`b1a547b1f73ce86205d9222ac19cff334b3b7a2e`, exposes `thread/inject_items`
in the app-server protocol and turn processor. YA now uses that public route.
The adapter test verifies role/text mapping and no `turn/start`/`turn/steer`;
a live installed Codex 0.153.4 probe verified persisted user and assistant text
without a new turn. Active-turn ordering is source-verified, not live-probed.

## Claude arm — attributed ordinary-turn fallback

YA does not advertise native assistant-role insertion for Claude. The shipped
fallback is the ordinary user-message envelope above. The older feasibility
notes below are not an approved transcript-editing path.

YA's `ClaudeProvider` uses Agent SDK `query({ prompt: queue })`, rather than
owning the Messages API history directly. Installed SDK 0.3.258 declares
`Query.streamInput(AsyncIterable<SDKUserMessage>)` and user-message-only query
input; no live assistant-history append method was found in its `Query`
interface. Its `SessionStore` option mirrors transcript writes and loads on
resume, rather than inserting into the active query. `shouldQuery: false`
documents a user-role append without an assistant reply, merged into the next
querying user message. That could support a future intermediate delivery mode,
but does not establish role-preserving assistant-history insertion. A separate
Messages API request would not update the incumbent Claude Code session.

The distinction is between model input and a live harness operation. The
[Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)
explicitly accepts synthetic assistant turns, even text Claude never produced.
Claude Code's [fork documentation](https://code.claude.com/docs/en/sub-agents#fork-the-current-conversation)
describes inherited conversation context and a final result returning to main;
it does not establish a general operation for splicing an independent branch's
assistant history into a live parent.

[Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)
has a separate validity constraint. Where prefix binding is enforced, changing
preceding system, tools, or messages invalidates affected thinking and later
thinking blocks. The default is a request error; the documented `drop_block`
option discards invalid thinking and permits the remaining input. This does
not make transplanted reasoning valid. YA's context route accepts visible
text only, and question-card extraction excludes thinking and tool blocks
before import. Original parent history is left intact. These documentation
claims were checked on 2026-09-06; they do not advertise a Claude SDK history
append capability that YA has not verified.

What I know from YA's provider (`packages/server/src/sdk/providers/claude.ts`,
`types.ts`):

- **`forkSession`** (`claude.ts:1294` → `sdkForkSession`; primitive at
  `types.ts:293`): copies the jsonl with **remapped UUIDs**, optional slice at
  `upToMessageId`, kept prefix **byte-identical** to source so prompt-cache
  warmth carries over. There is **no inject/seed API** — fork is slice-only.
- Today's summary is submitted as **one ordinary user turn**; YA injects no
  synthetic assistant turns.
- **Feasible but unsupported:** append well-formed jsonl records
  (`type: user|assistant`, `message.content` blocks, a fabricated `uuid` with a
  correct `parentUuid` chain) to the forked session file *before* the first
  `query()` resume. The Claude jsonl shape is well-understood — Codex's own
  importer (`records.rs`) parses exactly these records (assistant records,
  `text`/`tool_result` content blocks), so the inverse construction is
  tractable.
- **Fragile part:** a synthetic assistant turn with a `tool_use` block needs a
  matching `tool_result`, or the next API `messages` array is malformed.
  Mitigate by keeping synthetic turns **text-only** (the same flattening the
  Codex importer uses). Resume replays the jsonl, so it should not validate
  uuid provenance — but this is reasoned, not verified.

**Unverified (Claude):** whether `sdkForkSession` or the Agent SDK exposes any
post-fork append/seed hook; whether resume rejects records with fabricated
uuids or unbalanced tool blocks. Next probe: inspect `sdkForkSession` internals
and whether `claude.ts` can write to the forked jsonl path between fork and
first `query()`.

## Design implications

- **Provider-agnostic 80% needs no injection.** Honest header + explicit
  user/agent attribution *inside the single real user turn* covers the
  authorization-provenance and liveness-honesty audit need on every provider.
  Recommended default; do this regardless of (2).
- **True synthetic alternation buys one thing:** making the target *model*
  experience prior agent reasoning as its own turns, so it continues
  in-character rather than reading a third-party status dump. Codex supports it
  cleanly; native Claude insertion remains unverified and is not implemented.
- **Shared risk:** synthetic assistant turns put words in the model's mouth that
  it then treats as its own commitments — entrenching the summarizer's framing —
  and tool turns must be flattened, losing fidelity. Gate (2) behind a measured
  need (evidence that the flattened single-turn form degrades continuation),
  not as a default.
- **Current contract:** keep synthetic turns text-only, and adopt an
  in-band synthetic-content boundary marker (Codex's `<EXTERNAL SESSION
  IMPORTED>` is the precedent) so the transcript stays self-describing about
  what the model did vs. did not generate.

## Provenance

- Inspected source: `~/ya/.local-checkouts/openai-codex-inspect` @ `251b241`
  (2026-05-29). Treat as a snapshot, not a pinned dependency.
- Codex: `codex-rs/protocol/src/protocol.rs:2337` (`InitialHistory`);
  `codex-rs/core/src/codex_thread.rs` (`inject_response_items`,
  `inject_user_message_without_turn`);
  `codex-rs/external-agent-sessions/src/{export,records}.rs` (synthetic
  `RolloutItem` construction, flattening, provenance marker);
  `codex-rs/core/src/thread_manager_tests.rs` (`InitialHistory::Forked` usage).
- Claude: `packages/server/src/sdk/providers/claude.ts:1294` (`forkSession`);
  `packages/server/src/sdk/providers/types.ts:293` (fork primitive contract).
