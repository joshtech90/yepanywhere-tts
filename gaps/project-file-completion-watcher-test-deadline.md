# Project file completion watcher test can miss its deadline

`pnpm test` on macOS during the issue #124 renderer work failed in
`packages/server/test/services/projectFileCompletion.test.ts`, “uses existing
path-index filesystem observations and activity hints for nested additions”.
The `vi.waitFor` at the source-revision assertion uses the default one-second
budget; the revision was still unchanged when it expired. The full run had
4,844 other server tests passing. All eight tests in that file passed when
rerun alone, including the same filesystem observation.

No watcher behavior or timing guarantee was changed during the renderer fix.
Investigate watcher readiness and delivery under concurrent workspace test
load before changing the deadline. A deterministic readiness barrier or a
justified platform-aware observation budget may be appropriate; do not mask a
missing filesystem event with a sleep. This is outside the renderer boundary
and cannot safely be treated as a renderer regression.

Found 2026-09-10 while fixing malformed tool rendering for issue #124.
