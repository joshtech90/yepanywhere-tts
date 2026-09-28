# Native text catch-up depends on subscription count

`createSessionSubscription` in `packages/server/src/subscriptions.ts` appends
each native text delta to the shared `Process` catch-up accumulator inside
each subscription callback. Two live-delta subscribers therefore append the
same delta twice; no subscriber means no accumulation. Subscription cleanup
also clears the shared accumulator even if another subscriber remains.

The Codex cumulative-snapshot fix makes repeated snapshot writes idempotent,
but does not repair ownership of native delta accumulation. Move that state
update to the provider/process event boundary, once per provider event, and
leave subscription cleanup responsible only for its own state. Cover zero,
one and multiple subscribers, late join and disconnect with native deltas.

This is a code-path finding, not a reproduced user report. It is outside the
Codex snapshot ladder fix and should not be hidden by text deduplication.

Contributing-model: gpt-6-astra

Found 2026-09-26 while fixing cumulative Codex streaming snapshots.
