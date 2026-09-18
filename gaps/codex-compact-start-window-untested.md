# Refusing compaction during turn/start has no test

`6e4b624d2` added `runtimeState.pendingTurnStart` to the mid-turn compaction
guard in `packages/server/src/sdk/providers/codex.ts:2416`, closing the window
between sending `turn/start` and the app server assigning a turn id. Nothing
tests that clause: `rg pendingTurnStart packages/server/test` finds nothing,
and the one compaction-rejection test now waits for the process to reach
`in-turn` before sending its compact, so it lands on the `activeTurnId` clause
deterministically. Before that wait it reached the start window only by losing
a race under load, which is how the window was found rather than coverage.

Deleting the clause would therefore leave every test green.

The fixture makes this cheap to cover.
`packages/server/test/fixtures/codex/native-commands.mjs:81` answers
`turn/start` immediately; a branch keyed on a new input sentinel, like the
existing `"hold"` at line 88, could delay `reply({ turn })` long enough for the
test to send a compact during the round trip and expect 409.

Found 2026-09-18 while making the compaction-rejection test wait on the state
it asserts on.
