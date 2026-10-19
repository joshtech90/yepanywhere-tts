# Patient topic shifts: open waiting and hint design

Status: sketch. The entry points, per-source compaction thresholds, and
YA-managed compact-before-delivery landed 2026-10-18; their contract is
[patient topic shifts](../../topics/patient-topic-shift.md). This sketch keeps
what that slice deliberately left open. Default steering stays immediate.

## Which Codex work should hold delivery

Claude patient items wait for verified idle after reported background work.
Codex patient items still deliver at the ordinary turn end: YA's
`CodexProviderWorkTracker` records unified-exec terminals, subagent activity
and foreground sleeps, but its snapshot returns `retained: false`, so recorded
work neither blocks idle reaping nor patient delivery.

Waiting past turn completion matters for work left running afterward, but a
dev server is a counterexample to treating every surviving terminal as
unfinished work for the current task. Do not make all Codex background work
retain the session globally. The open problem is telling finite work being
awaited apart from services deliberately left running; prefer explicit
provider or agent evidence over guesses from command names.

When a rule exists, the provider contract should report eligibility, blockers,
and the events that can change them; recheck eligibility immediately before
delivery. Show blocking jobs and allow an explicit send-now override; never
kill them to unblock the message. Unknown work must stay visibly unknown
rather than being described as finished. Reuse the durable queue and
event-driven promotion; add no standing idle polling. The inventory is
incomplete by design (detached descendants, missing provider events), and how
often finite Codex work outlives its parent turn in ordinary use is unmeasured.

See [provider work](../../topics/provider-wait-and-background-work.md) and
`packages/server/src/sdk/providers/codex-provider-work.ts`.

## Provider-managed compaction hints

A provider may replace YA-managed compaction with its own patient-topic-shift
hint only after evidence that the hint behaves better, with the alternative
implemented in its adapter, the reason exposed, and mutual exclusion between
hinting and compacting for one item. No provider qualifies yet. An optional
visible advisory to the model is also unbuilt; saying "consider compacting"
invokes nothing, and the model may have no authorized compaction tool.

## Defaults and presentation

New-user threshold values stay Off pending a decision; the sketch expected the
patient-default threshold to end up higher than the explicit-click one. The
patient queue default may eventually be presented as the same topic-shift
intent across providers.

## Acceptance still owed

Exercise a finite background build, an intentionally persistent dev server,
subagent completion and missing inventory once Codex waiting exists. The
landed slice covers compaction success, failure with send-without-compacting,
below-threshold and unknown usage, and turn-end delivery on a non-Claude
provider.

Contributing-model: gpt-6-astra
Contributing-model: opus-5.5
