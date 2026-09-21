# Project file completion watcher test can miss a nested addition

`pnpm test` failed in
`packages/server/test/services/projectFileCompletion.test.ts` at the
"uses existing path-index filesystem observations and activity hints for nested
additions" check: `index.sourceRevision()` remained `1` after writing
`nested/new.txt`, through the test's `vi.waitFor` budget. The same test passed
immediately when its file was rerun alone, so this is load-sensitive watcher or
test-settling behavior rather than a deterministic product failure.

Reproduce under the full workspace test load and make the test wait on the
owned watcher contract rather than a host-timing assumption. Do not merely
increase the timeout without establishing which notification was missed or
late.

Found 2026-09-20 while running the required checks for the principals-and-grants
documentation change.
