# Session hydration effect's reload trigger produces a lint warning

`packages/client/src/hooks/useSessionMessages.ts:704` lists `reloadGeneration`
in the hydration effect's dependencies without reading it in the body, so Biome
reports `lint/correctness/useExhaustiveDependencies` on a full `pnpm lint`.

The counter exists only to re-run that effect: `reloadSession` (:517) sets
`forceFreshLoadRef`, resets the coordinator's entry state, and bumps the
counter, and nothing else reads it. Removing it as the fix suggests would leave
`reloadSession` unable to trigger a reload when every other dependency is
unchanged — the same shape as `gaps/all-sessions-settle-effect-lint-warning.md`
and `gaps/file-viewer-recursive-effect-lint.md`.

Cheap fix if the hydration contract allows it: give the trigger a
representation the rule understands — read the generation in the body, or
depend on the ref-and-counter pair the reload actually means — then delete this
entry. A narrow documented exception is the fallback.

Found 2026-09-18 while running the required checks for harsh-review item 8
(gateway process-group retention), which touched no client code.
