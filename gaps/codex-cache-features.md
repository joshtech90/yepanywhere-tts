# Codex cache features YA cannot use yet: fork rescan and Astra in-place effort

Two Codex-side prompt-cache behaviors limit what the
[mid-session effort change](../topics/mid-session-effort-change.md) warning
can offer on Codex. Neither is fixable in YA alone; this entry records the
current state so the warning copy and the Astra exemption are revisited from
evidence.

## Fork pays a prompt rescan

YA's Codex fork is the native `thread/fork`, which gives the child a fresh
thread id, and Codex derives `prompt_cache_key` from the thread id
(`codex-rs/core/src/client.rs`, pinned 0.154.0). Measured forks re-read
85–94% of the parent context
([quick-answer fork gap](quick-answer-fork-cache-efficiency.md)). So the
warning's "fork at the new effort" choice keeps the source session
unchanged on Codex but does not avoid the re-read; the dialog says so.

Revisit when Codex ships a fork or rewind that keeps the cache key: unreleased
`main` already switches the TUI's Esc-Esc backtrack to the in-place
`thread/revert` ([fork-is-the-only-rewind gap](fork-is-the-only-rewind-and-changes-the-cache-key.md)),
and a thread-based fork that inherits the parent's key, or an exposed
`prompt_cache_key` override on `thread/fork`, would let the fork choice be
cache-neutral. Then measure first-request cached tokens on a warm parent as
the quick-answer gap requires before changing the dialog copy.

## Astra `configuration_update` is not enabled

OpenAI's reasoning guide documents, for GPT-6 Astra only in standard
single-agent mode, changing effort between responses with
`configuration_update` items while keeping request-level `reasoning.effort`
unchanged so the cached prefix survives. Source:
<https://developers.openai.com/api/docs/guides/reasoning?api-mode=responses>.

State in the pinned Codex 0.154.0 source (installed CLI 0.155.1):

- `core/src/session/reasoning_effort.rs` appends a
  `ResponseItem::ConfigurationUpdate { reasoning: { effort } }` to surviving
  history when the effective effort changes, "without replacing the
  request-level reasoning effort".
- It is gated on `Feature::ReasoningEffortOverride`
  (`features/src/lib.rs`, key `reasoning_effort_override`, stage
  `UnderDevelopment`, `default_enabled: false`), on the model's catalog flag
  `use_responses_lite`, and on the OpenAI provider. The local
  `~/.codex/models_cache.json` marks both `gpt-6-astra` and `gpt-5.6-sol`
  `use_responses_lite: true`, so Codex's gate is broader than the doc's
  Astra-only statement; the doc is the authority on what the backend honors.
- YA's generated protocol already carries the `configuration_update`
  `ResponseItem` variant and the durable-transcript schema accepts it
  ([provider-refresh](../topics/provider-refresh.md) 0.154.0 notes), but no
  local rollout has contained one.
- YA sends effort changes through `thread/settings/update` / the active-turn
  settings update (`packages/server/src/sdk/providers/codex.ts`, `setEffort`),
  which change the request-level effort. YA passes thread `config` overrides
  (`buildThreadConfigOverrides`) but never a `features` table, so the Codex
  feature stays off.

Enabling it would be a Codex compatibility edit requiring maintainer approval
([provider development](../docs/development/providers.md) § Codex Version
Bump Audit): add `features.reasoning_effort_override = true` to the thread
config overrides for Astra threads (or globally, letting Codex's own gates
decide), then measure a warm Astra session's cached tokens across an effort
change. Until then `effortChangeKeepsPromptCache` in
`packages/shared/src/long-context-effort-warning.ts` returns false for Astra
and the warning applies to it like every other Codex model. When enabled and
verified, flip that branch and drop this section.

Found 2026-09-19 while building the long-context effort-change warning.
Contributing-model: fable-5.1
