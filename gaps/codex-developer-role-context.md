# YA does not use Codex's developer-role context channel

YA currently delivers its post-compact continuation as an ordinary user
message. The instruction and quoted history are separate prompt parts, but
`Supervisor.maybePostCompactReplay` joins them before the common message queue.
This preserves one self-contained quotation. It does not yet carry structured
parts into individual provider adapters.

Codex has a supported channel worth experimenting with; whether it improves
intent recognition or continuation is unmeasured. Leave it disabled until an
experiment supports a useful choice. This gap records the requested experiment,
not evidence that current user-role delivery is defective.

## Verified seam

YA's generated app-server `v2/TurnStartParams.ts` and `TurnSteerParams.ts`
under `packages/server/src/sdk/providers/codex-protocol/generated/` expose
`additionalContext`. Entries have a `value` and a kind: `application` or
`untrusted`. The inspected Codex reference is `rust-v0.154.0`.

- `codex-rs/context-fragments/src/additional_context.rs` maps application
  context to model-visible developer messages and untrusted context to user
  messages. Each value is capped at 1,000 tokens, with middle truncation.
- `codex-rs/core/src/state/additional_context.rs` tracks keyed values and emits
  changed entries. Reusing a key is not proof that earlier conversation content
  disappears; lifecycle and compaction behavior need tests.
- `codex-rs/core/tests/suite/additional_context.rs` tests that application
  context reaches the model as developer input without becoming an ordinary
  user-message item.
- YA's `packages/server/src/sdk/providers/codex.ts` currently does not send
  this field. Its ordinary user-input path is distinct from this capability.

These are Codex app-server capabilities, not a promise that every SDK accepts
arbitrary mid-session system/developer turns. A higher-authority message may
better identify YA-authored instructions, but cannot by itself resolve ambiguity
about whether the user's task is finished.

## Experiment and implementation plan

1. Carry the existing structured continuation parts to the provider boundary,
   retaining one-message formatting as the default for other adapters. Keep
   historical turns explicitly quoted with their original roles. Never elevate
   copied user or assistant history into developer instructions.
2. Add an explicit, default-off Codex experiment using `application` context
   only for YA's short continuation instruction. Start at replay count zero.
   Verify actual model-facing role, resume behavior, repeated updates, and the
   1,000-token cap against the pinned app-server. `turn/steer` requires user
   input, so do not assume context-only active-turn injection works.
3. Compare identical wording in ordinary user delivery and developer context on
   unfinished tasks that go idle after compaction. Check completion, unnecessary
   work after an already-finished task, and respect for a later user correction
   or new task. Repeat enough to distinguish role effects from run variation;
   record a null result as a valid outcome.
4. Only then test nonzero replay. Preserve its quotation boundary even if the
   YA instruction uses another role; test misleading historical instructions,
   truncation, and stale requests. Do not infer a benefit merely from seeing a
   different wire role.

Tool activation is a related possible use for YA-authored context, but informing
the model is separate from changing the provider's actual callable tool set.

Related: [post-compact replay](../topics/post-compact-replay.md),
[agent context injection](../topics/agent-context-injection.md).

Found 2026-09-16 while separating YA's continuation instruction from quoted
before-compaction activity, at the user's request.
