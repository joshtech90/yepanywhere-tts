# Post-compact replay

> Post-compact replay is a default-off, per-provider YA setting that
> injects a hidden continuation user turn after compaction settles, with
> an optional quotation of the last N user/assistant prose turns from
> before compaction.

Topic: post-compact-replay

Related topics: [compact-and-handoff](compact-and-handoff.md),
[resume-compaction](resume-compaction.md),
[injected-message visibility](injected-message-visibility.md),
[fork-from-turn](fork-from-turn.md),
[agent context injection](agent-context-injection.md),
[vanilla defaults](vanilla-defaults.md),
[settings UI placement](settings-ui-placement.md).

## Why this is tentative

A provider-native compact already rewrites history, usually with a model-written
summary plus a preserved tail. Replaying a fixed N prose turns on top of that
is a blunt substitute for that summary, and it is redundant for providers that
already continue the same turn through compaction (Codex commonly does). The
setting exists so an operator can try it where a harness instead goes idle
after compact and loses recent prose.

Start with N = 0 on a backend observed going idle with unfinished work. That
isolates whether a continuation nudge helps. Add replay only when recent intent
is also being lost; replay can repeat obsolete requests. This setting cannot
recover a backend that remains busy rather than reaching YA's idle state.

## Contract

- **Default off.** No provider receives a YA continuation until its checkbox
  is enabled. Novel injected provider text stays vanilla-off.
- **Placement.** Settings → Providers → Continue after compaction. One N slider
  (0–20) and one checkbox per provider. Older servers omit the field and the
  client hides the row.
- **When it fires.** After a `compact_boundary` (or compact-success status)
  settles, once the process is idle, not retaining provider work, and has no
  queued or deferred user input. A new human turn that arrived during compact
  cancels the pending continuation.
- **N = 0.** The injected turn is the stable opener plus `continue.`
- **N > 0.** The turn copies the last N user/assistant prose turns (tools,
  thinking, compact banners, and slash commands omitted). Every historical line
  is blockquoted, with explicit `user:` and `assistant:` labels. YA identifies
  it as before-compaction activity, not a new request, and says later user
  instructions take precedence. The quotation ends before `continue.`; the
  40,000-character budget clips history without clipping that framing.
- **The replayed window.** YA keeps the last 20 prose turns of the live
  process, each trimmed and capped at 8,000 characters with a trailing
  truncation marker. A turn is stored capped exactly as it is later quoted.
  YA's own continuation never enters that window, including when the provider
  echoes it back as a user row, so one replay cannot displace the prose the
  next one needs.
- **Delivery.** YA builds separate instruction, quoted-history, and continuation
  parts, then joins them into one ordinary user message for all providers.
  Internal separation does not split the quotation across messages or enable
  elevated roles. [Codex developer-role context](../gaps/codex-developer-role-context.md)
  remains an experiment to evaluate, with no demonstrated behavioral benefit.
- **Visibility.** The turn is `metadata.hidden` and
  `automaticSource: "post-compact-replay"`. Transcript projection also hides
  persisted user rows that start with the stable opener, so the replay is
  model-visible and not painted as a user bubble. The compact boundary remains
  the visible marker.
- **Skip.** Disabled provider, failed compact, process death, existing queue
  or deferred messages, or automation paused until a user turn.

## Not a compact summary

This path does not replace provider compaction, resume-compaction, or restart
handoff. It does not ask a model to summarize. It copies recent prose YA
already observed on the live process, so a process that just started has
nothing to replay and degrades to continue-only.
