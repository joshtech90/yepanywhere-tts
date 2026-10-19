# Two capability transition reviews are overdue

`pnpm capabilities:audit` reports zero errors but two policy warnings:
`codex-paginated-rollout-lineage` and `session-fork-turn-intents` have transitional
review dates of 2026-10-01. The entries are in
`packages/shared/src/server-capabilities.ts`.

These warnings predate the managed artifact viewer. Changing review dates or
removing compatibility fallbacks without checking the supported server corpus
would conceal a contract decision, so they are deliberately outside this
artifact-delivery change. Review each transition against the current release
horizon, then remove an obsolete fallback or record a justified next review.

Found 2026-10-16 while validating first-party managed artifact delivery.
