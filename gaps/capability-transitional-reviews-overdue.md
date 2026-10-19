# Two capability retirement reviews are overdue

`pnpm capabilities:audit` reports zero contract errors but warns that
`codex-paginated-rollout-lineage` and `session-fork-turn-intents` reached their
2026-10-01 review dates. These warnings existed before the GitHub status work.
Do not suppress them or arbitrarily advance dates: each requires its owning
supported-release/fallback review and a maintainer decision before gate removal.
That provider/fork compatibility work is outside the requested GitHub feature.

Found 2026-10-16 while validating durable GitHub status and extension groups.
