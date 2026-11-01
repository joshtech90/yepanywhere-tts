# Codex fork pays a prompt rescan

A Codex-side prompt-cache behavior limits what the
[mid-session effort change](../topics/mid-session-effort-change.md) warning
can offer on Codex. It is not fixable in YA alone; this entry records the
current state so the dialog's fork copy is revisited from evidence.

YA's Codex fork is the native `thread/fork`, which gives the child a fresh
thread id, and Codex derives `prompt_cache_key` from the thread id
(`codex-rs/core/src/client.rs`, pinned 0.154.0). Measured forks re-read
85–94% of the parent context
([quick-answer fork gap](quick-answer-fork-cache-efficiency.md)). So the
warning's "fork at the new effort" choice keeps the source session
unchanged on Codex but does not avoid the re-read; the dialog says so.
Since Codex 0.165.0 the dialog appears only for older Codex models: GPT-6
models change effort in place without losing the cache.

Revisit when Codex ships a fork or rewind that keeps the cache key: unreleased
`main` already switches the TUI's Esc-Esc backtrack to the in-place
`thread/revert` ([fork-is-the-only-rewind gap](fork-is-the-only-rewind-and-changes-the-cache-key.md)),
and a thread-based fork that inherits the parent's key, or an exposed
`prompt_cache_key` override on `thread/fork`, would let the fork choice be
cache-neutral. Then measure first-request cached tokens on a warm parent as
the quick-answer gap requires before changing the dialog copy.

The former Astra in-place effort section closed on 2026-10-29: Codex
0.165.0 enables the update by default and a warm-session measurement
confirmed the cache survives on every GPT-6 model
([evidence](../topics/mid-session-effort-change.evidence.md)).

Found 2026-09-19 while building the long-context effort-change warning.
Contributing-model: fable-5.1
