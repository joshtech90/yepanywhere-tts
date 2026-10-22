# Consider 120-column TypeScript/JavaScript formatting after Kyle merges

The current Biome width splits readable conditions across several lines,
making line-oriented searches less useful. The motivating example is the
ContextMenu/Shift+F10 conditional in `packages/client/src/pages/IssuesPage.tsx`.
Consider a 120-column JavaScript formatter limit in `biome.json` (also applies
to TypeScript), rather than changing the launcher `scripts/biome.cjs`.

User-directed deferral: give Kyle a chance to merge cleanly before changing
formatting policy or producing broad formatting churn. Keep this separate from
the Issues & PRs feature. Review the resulting diff and decide whether a
dedicated formatting-only commit is warranted; do not mix it with behavior
changes. The configuration and repository formatting remain unchanged for now.

Found 2026-10-21 while implementing issue-content cache TTL controls.
Contributing-model: gpt-6-astra
