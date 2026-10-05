# Client token counts are formatted by five near-identical helpers

Compact token-count formatting is reimplemented per surface, with drifting
output: `formatTokens` in `client/src/components/ContextUsageIndicator.tsx`
("34.5K", uppercase, decimals from 1,000), `formatTokenCount` in
`client/src/pages/settings/UserUsageTable.tsx` (exact below 10,000, then
lowercase "k"), plus private copies in
`client/src/pages/settings/CacheMissInactivityChart.tsx`,
`client/src/pages/settings/CacheMissEventTable.tsx`, and
`client/src/components/CacheMissBillingToasts.tsx`. Paths are relative to
`packages/`. The same count can therefore read "12.3K" in the context popover
and "12.3k" or "12,345" in Settings.

The context breakdown reuses the indicator's `formatTokens` (now exported) so
the popover agrees with the pie's tooltip; consolidating every caller onto one
shared helper, with one decided casing and exact-below threshold, was outside
that change and alters visible text on the settings surfaces.

Found 2026-10-01 while adding the context breakdown.
