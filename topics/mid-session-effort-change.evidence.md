# Mid-session effort change evidence

This companion preserves the dated prompt-cache measurements behind the
live contract in [`mid-session-effort-change.md`](mid-session-effort-change.md):
which models miss the cache on an effort change and which keep it. It is
evidence, not the current product contract.

## 2026-09-23 — Claude cache measurement

Setup: Agent SDK 0.3.280 (`claude-agent-sdk-darwin-arm64` CLI), model
`claude-sonnet-5`, adaptive thinking with summarized display, 1h cache TTL.
Numbers are `cache_read_input_tokens` / `cache_creation_input_tokens` from
the session JSONL or the CLI's JSON result.

**Live YA session.** Started through `POST /api/projects/:projectId/sessions`
at `on:medium` with ~98k tokens of repository source as the first message
(one-word replies thereafter). Effort changed through
`POST /api/processes/:processId/config` (`{"thinking":"on:high"}`), the path
the dialog's Change anyway uses; it calls `applyFlagSettings({effortLevel})`
on the live query without a restart.

| Turn | Effort | Read | Created |
|---|---|---|---|
| 1 | medium | 0 | 97,770 |
| 2 | medium | 97,770 | 100 |
| 3 | changed to high | 0 | 97,971 |
| 4 | changed back to medium | 97,870 | 202 |

Turn 4 reused turn 2's medium entry: each effort keeps its own cache entry,
and returning to an effort still inside its TTL hits it.

**Request capture.** The same sequence driven directly through the SDK
behind a logging HTTP proxy (`ANTHROPIC_BASE_URL`). Between the requests
before and after `applyFlagSettings`, `system` and `tools` were
byte-identical and `messages` was a pure append; the only other difference
was `output_config.effort` (`medium` → `high`). The request still read 0.
Claude Code places a cache breakpoint on the system prompt, so an unchanged
tools+system prefix missing as well means effort partitions the cache for
the whole prompt, the way a model change does. Whether the API renders
effort into the prompt internally is not observable from the client.

**Cold standalone control.** `claude -p` with a unique
`--append-system-prompt` nonce and ~53k-token prompt, fresh process per
run: medium 0 / 52,759; high 0 / 52,821; high again 52,821 / 0; low
0 / 52,821. Earlier runs without a system-prompt nonce appeared to show
effort-independent hits, but they were confounded by entries warmed at
other efforts moments before; keep every effort cold when repeating this.

**Forks** (`POST .../fork` with `clone-latest-complete` and `thinking`, then
`POST .../resume`), from the session above while its medium and high
entries were warm:

| Fork effort | Read | Created |
|---|---|---|
| xhigh (never used by the source) | 0 | 98,493 |
| medium (source's current effort) | 98,072 | 422 |

A fork at high read 97,971, but only because turn 3 had already cached that
prefix at high; it is not evidence that forks bridge efforts.

Two incidental findings: the first attempt, using random NATO-alphabet
filler, was refused by a safety classifier (`stop_reason: refusal`), so
use real source text as filler; and the session's first turn created a
new tools prefix after MCP tools loaded, an unrelated one-time miss.

## 2026-09-24 — Opus 5.5 measurement

Same SDK and harness as the Claude cache measurement above, with
`claude-opus-5-5` and a fresh nonce per run so every prefix started cold.
Each turn after the first asked a small arithmetic question ("Think it
through: what is 17*23+41?") so the model produced thinking blocks. Effort
changed through `applyFlagSettings({effortLevel})`, the call behind YA's
live effort control. The identical script ran on `claude-sonnet-5` for
comparison:

| Turn | Effort | Opus 5.5 read / created | Sonnet 5 read / created |
|---|---|---|---|
| t3 | medium | 123,296 / 92 | 129,456 / 130 |
| t4 | changed to high | 123,388 / 92 | 0 / 129,696 |
| t5 | high | 123,480 / 92 | 129,696 / 155 |
| t6 | changed to low | 123,572 / 92 | 0 / 129,961 |
| t7 | changed to medium | 123,664 / 94 | 129,586 / 486 |

Sonnet's t7 hit only because its medium entry from t3 was still warm. The
captured request bodies for both models have the same shape (identical
`thinking`, `context_management`, message roles, and a cache breakpoint on
the trailing `system`-role message), so the difference is how the API
handles each model, not how YA or Claude Code builds the request. Through
YA's own `POST /api/processes/:processId/config` route, an Opus 5.5 session
likewise kept its cache across switches to low and to xhigh (90,286 and
90,382 read).

Opus 5.5 quirk, independent of effort: until the conversation contains at
least one assistant message with a thinking block, every request reads only
the tools and system prefix and re-creates all messages. A first run whose
turns were "Reply with exactly: OK" (no thinking) missed on every turn,
with and without effort changes; so did the YA run's early turns until the
first thinking block appeared. Real Opus 5.5 sessions on this machine think
early and showed 94-99% cache hit rates, so this does not affect the
exemption, but it will confound any repeat measurement that uses
non-thinking turns.

## 2026-10-29 — Codex 0.165.0 measurement

Codex 0.165.0 made `reasoning_effort_override` stable and default-on
(upstream #56163). A scratch client drove `codex app-server` directly with
the same `turn/start` `effort` field YA sends for an effort selected between
turns: four turns per fresh thread, each "Reply with exactly <label>",
effort low, low, high, high. The prompt was Codex's own ~36-42k-token
instructions and tools; cached counts are `thread/tokenUsage/updated`
`last.cachedInputTokens`:

| Model | Same effort (t2) cached / input | Changed to high (t3) cached / input |
|---|---|---|
| gpt-6.1-sol | 37,248 / 37,437 | 37,248 / 37,467 |
| gpt-6.1-terra | 36,352 / 42,636 | 42,496 / 42,666 |
| gpt-6-astra | 36,352 / 42,150 | 41,984 / 42,180 |
| gpt-6-sol | 35,968 / 41,701 | 41,600 / 41,731 |
| gpt-6-luna | 36,096 / 36,259 | 36,096 / 36,289 |
| gpt-5.6-sol | 35,584 / 41,419 | 6,784 / 41,449 |
| gpt-daybreak-blue-latest | 35,584 / 41,419 | 6,784 / 41,449 |

The GPT-6 rollouts each contain two `configuration_update` items carrying
the new effort; the GPT-5.6 Sol rollout has none. The deciding flag is
`supports_reasoning_effort_updates` in the live catalog Codex downloads
(`~/.codex/models_cache.json`): true for every GPT-6 model, false for the
GPT-5.6 family and Daybreak. The bundled catalog in the 0.165.0 source
marks only Astra and GPT-6.1 Sol/Terra, so read the live cache, not the
repository file, when re-checking. `model/list` does not expose the flag.

Decision (user-directed): warn on Codex only for the known older
generations (GPT-5 and earlier, Daybreak) and assume newer models support
the update, rather than keep an allowlist of measured safe models.
