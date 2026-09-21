# Mid-session effort change

> A mid-session effort change re-renders the provider's system prompt, so on
> a long-context session the next request re-reads most of the cached prompt;
> YA warns before such a change on enabled providers past a configurable
> token threshold and offers a fork at the new effort instead.

Topic: mid-session-effort-change

Status: implemented 2026-09-19. The per-provider enablement and token
threshold live in Settings → Providers; the warning fires from both effort
surfaces (the composer's thinking chooser and the provider-badge model panel).
Per-model configuration is deferred; see
[mid-session-effort-change.sketches.md](mid-session-effort-change.sketches.md).
Browser check: `packages/client/e2e/long-context-effort-warning.spec.ts`
drives both surfaces against a mocked long-context session and records the
dialog captures.

Related topics: [claude-thinking-config](claude-thinking-config.md) (how the
live effort control is applied), [provider-fork-support](provider-fork-support.md)
(the fork the dialog offers), [cache-miss-accounting](cache-miss-accounting.md)
(how a re-read shows up afterwards), [prompt-cache-keepalive](prompt-cache-keepalive.md),
[settings-ui-placement](settings-ui-placement.md).

## Why

On Claude, the selected effort is part of the rendered system prompt, so
changing it mid-session changes the cached prefix and the next request
re-reads the whole conversation (user observation, 2026-09-19; the
Anthropic cache is an exact-prefix match). On Codex the effort is the
request-level `reasoning.effort`, and OpenAI's own guidance is to keep that
unchanged to preserve the cached prefix. Either way a routine-looking control
can silently cost a full re-read of a 200k-token session, which is the same
class of cost the [cache-miss-accounting](cache-miss-accounting.md) monitor
exists to surface after the fact. This topic surfaces it before.

## Contract

- **Trigger.** Before YA applies a thinking option whose *effort component*
  differs from the session's current one. The effort component is the level
  of an `on:<level>` option and absent for `auto` and `off`, so `auto` →
  `on:high` and `on:high` → `off` count as changes while `auto` → `off` does
  not. Both mid-session surfaces route through one guard: the composer's
  live thinking chooser (`SessionPage.handleLiveThinkingChange`) and the
  provider-badge model panel (`ModelSwitchModal.applyConfig`).
- **Condition.** The session's provider is checked in the setting, the
  session's last request size (`contextUsage.inputTokens`, the whole prompt
  including cached reads on Claude) is known and at least the threshold, and
  no cache-safe mechanism exists for the provider/model pair
  (`effortChangeKeepsPromptCache` in
  `packages/shared/src/long-context-effort-warning.ts`, currently false for
  every pair; see § Codex Astra below).
- **Dialog.** States the last request size and the from/to efforts, and
  offers three choices: **Change anyway** applies the change exactly as it
  would have without the warning; **Fork at <effort>** creates a
  `clone-latest-complete` fork whose launch settings carry the new thinking
  option and navigates to it, leaving the source session untouched at its old
  effort; **Cancel** applies nothing. The fork choice is hidden when the
  session cannot be forked now (provider without fork support, session owned
  elsewhere, or a turn in flight). Dismissing the dialog is Cancel.
- **Fork launch settings.** The fork route accepts an optional `thinking`
  option and, when present, records it as the fork's effective launch
  settings with the inherited model and the source's permission mode and
  service tier. The fork's composer therefore sends that effort on its first
  turn instead of the browser's per-model default, and server-side turns use
  it too. A fork without `thinking` keeps today's behavior.
- **Setting.** `longContextEffortWarning` is a server-persisted setting
  ([settings-ui-placement](settings-ui-placement.md) mechanism 3) with
  per-provider checkboxes and `thresholdTokens`. Default: Claude and Codex
  checked, 5,000 tokens. The slider spans 0–500,000 tokens; the exact field
  accepts any non-negative integer. 0 warns on every effort change. It is
  edited in Settings → Providers beside the other per-provider rows.
- **Older servers.** A server that does not return the setting never warns
  and never receives a `thinking` fork field; the client offers nothing
  extra. Presence of the setting is the gate, since the setting and the fork
  field shipped together.
- **Default-on rationale.** This is a warning about a hidden cost of an
  existing control, not a new behavior of the session; the change still
  happens on confirmation and the previous one-click path remains one extra
  click. That is the bounded exception the maintainer chose over
  [vanilla-defaults](vanilla-defaults.md)' default-off rule; unchecking a
  provider restores the silent path.

## Provider notes

- **Claude.** The fork keeps the source's prefix byte-identical and forks
  within the cache window have been measured to hit the parent's cache
  ([fork-is-the-only-rewind gap](../gaps/fork-is-the-only-rewind-and-changes-the-cache-key.md)
  § Claude), so a fork at the new effort is the cheap path: the fork's first
  request pays only for the new system prompt while the source session stays
  warm at its old effort. The dialog says so.
- **Codex.** A Codex fork changes the thread id and therefore the
  `prompt_cache_key`, and measured forks re-read most of the context
  ([quick-answer fork gap](../gaps/quick-answer-fork-cache-efficiency.md)),
  so the fork choice does not save the re-read on Codex today; it only keeps
  the source session unchanged. The dialog states this. The Codex-side
  remedies are tracked in [codex-cache-features](../gaps/codex-cache-features.md).
- **Codex GPT-6 Astra.** OpenAI documents an in-place effort change for
  Astra through `configuration_update` items that leave the request-level
  effort, and so the cached prefix, unchanged. The pinned Codex 0.154.0
  source implements it (`core/src/session/reasoning_effort.rs`) behind the
  `reasoning_effort_override` feature, which is under development and
  default-off, and only for models whose catalog entry sets
  `use_responses_lite` (Astra and Sol in the local catalog). YA does not
  enable Codex features, so today an Astra effort change still goes through
  `thread/settings/update` at request level and the warning applies. Once
  that feature is enabled and a warm-session measurement shows the cache
  survives, `effortChangeKeepsPromptCache` exempts Astra; details in
  [codex-cache-features](../gaps/codex-cache-features.md).
