# All Sessions settle effect warns about a deliberate dependency

`pnpm lint` reports `lint/correctness/useExhaustiveDependencies` on
`packages/client/src/pages/GlobalSessionsPage.tsx:491`: the quiet-period effect
lists `scan.running` as a dependency but reads it through `scanRunning.current`
inside the timer callback, so Biome calls the dependency unnecessary and offers
to remove it.

The dependency is deliberate, and the comment above the effect says so: a scan
finishing re-runs the effect and rearms a full 500 ms quiet period, which is
what keeps a timer armed mid-scan from reflowing the row milliseconds after the
last match arrives. Taking Biome's fix would silently drop that rearm, so the
warning cannot be cleared by editing the dependency list. Deciding between a
narrow documented lint exception and restructuring the effect so the rearm is
expressed by something the effect body reads belongs with the All Sessions
search work, not with an unrelated server fix.

This is the only `pnpm lint` warning without a gap entry; the other,
`FilePathLink.tsx`, is `gaps/file-viewer-recursive-effect-lint.md`.

Found 2026-09-18 while running full lint for a speech vocabulary fix.
Contributing-model: opus-5
