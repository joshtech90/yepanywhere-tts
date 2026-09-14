# Quick Answer forks can reprocess nearly the entire parent context

Quick Answer uses an archived full-context helper fork through
`packages/client/src/hooks/useQuestionAside.ts`. Native Codex `thread/fork`
avoids copying the full transcript on disk but does not guarantee reuse of the
parent's inference cache. Even a short answer can consume substantial uncached
input. Contract: [provider-agnostic asides](../topics/provider-agnostic-btw-asides.md).

## Observed evidence

On 2026-09-07, the three measurable Quick Answer forks, all using native
Codex 0.153.4 and `gpt-6-astra`, reported:

| Input tokens | Cached tokens | Uncached tokens | Output tokens |
|---:|---:|---:|---:|
| 120,590 | 12,160 | 108,430 | 125 |
| 223,319 | 12,160 | 211,159 | 64 |
| 198,116 | 7,040 | 191,076 | 54 |

All three had large misses: 100% of measured requests, with 94.2% of aggregate
input uncached. Four other Quick Answer sessions had no usable measurement:
three earlier storage clones never reached their question turn, and one native
fork was interrupted without usage. They are neither hits nor misses.
The last measured fork's parent had large cache hits immediately before and
after the fork. This weakens idle expiry as the explanation for that sample.

Codex 0.153.4 derives ordinary requests' `prompt_cache_key` from their own
session ID, so a fork changes the key. Its `thread/fork` and configuration
schema expose no usable override. Different routing is a plausible contributor;
the backend cache decision and exact request-prefix comparison were not
observed, so it is not a proven sole cause.

Sources: [Codex key selection](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/src/client.rs#L515),
[fork parameters](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server-protocol/schema/typescript/v2/ThreadForkParams.ts),
[configuration schema](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/core/config.schema.json),
and [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Native `/side` sample

On 2026-09-08, one app-server probe reproduced the Codex 0.153.4 TUI's
saved-parent → ephemeral `thread/fork` → `thread/inject_items` boundary →
child turn sequence, using the exact side developer instructions and boundary
from that tag's `tui/src/app/side.rs`. Model: `gpt-6-astra`, medium effort;
one synthetic reference corpus and an immediate child recall question.

| Turn | Input tokens | Cached tokens | Uncached tokens | Output tokens |
|---|---:|---:|---:|---:|
| Parent | 76,534 | 12,160 | 64,374 | 5 |
| Side | 76,276 | 11,520 | 64,756 | 5 |

Both answers were `READY`; the child correctly recalled the parent's answer.
The child had 84.9% uncached input. This measures one reproduction through
app-server primitives, not the interactive TUI, and does not establish a
universal miss rate. Terminal-specific visualization instructions were omitted
from both turns. The first attempted setup used an ephemeral parent and failed
with `no rollout found` before any child model call; it supplies no fork-usage
sample. A saved parent corrected that invocation error. The native binary
reported a stale temporary-directory cleanup warning but both measured turns
completed without tools, retries, or turn errors.

Source: [native side setup](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/tui/src/app/side.rs).
The earlier assertion that `/side` could not share cache preceded measurement
and was unsupported. These observations warrant measuring a proposed native
integration, not treating API structure as proof of cache behavior.

## Disposition and closure

The maintainer is disabling Quick Answer pending evidence of efficient forks
in Claude or Codex. The feature remains opt-in and default-off; its setting
caption now discloses the measured Codex miss rate. This finding does not
establish Claude's cache behavior.

Revisit when either provider documents or ships reliable parent-prefix cache
reuse, or Codex exposes a persisted cache-key override usable through native
fork and resume. Reuse the parent's existing key rather than assigning a new
key only to the child. Verify actual first-request cached-token usage with
representative warm parents and preserved prompt-affecting configuration;
protocol support or cheap on-disk cloning alone does not close the gap.
Update the warning from new measured evidence and delete this gap when the
efficient path is implemented and verified. No provider-runtime patch, proxy,
or automatic feature re-enablement is authorized by this deferral.

Found 2026-09-08 while investigating Quick Answer's large Codex cache misses.
