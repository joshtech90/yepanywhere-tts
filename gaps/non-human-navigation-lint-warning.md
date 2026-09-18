# Navigation load-completion trigger produces a lint warning

`packages/client/src/hooks/useNonHumanUserTurnNavigation.ts:105` lists
`completedLoads` in an effect's dependencies without reading it in the effect
body. Biome reports `lint/correctness/useExhaustiveDependencies` on full lint.

The state increments when `loadOlder()` settles, after clearing the in-flight
page marker. It appears intended to trigger another navigation attempt even
when the options object and page cursor have not changed. Removing the
dependency mechanically could strand that attempt. Review the navigation
contract and its unchanged-cursor/failure cases before deciding whether this
trigger needs a narrow documented lint exception or a different representation.

Deferred during speech-runtime isolation because the diagnostic crosses an
independent UI pagination contract; speech's changed files lint cleanly.

Found 2026-09-14 during local STT migration verification.
