# Local browser checks fail while source CI passes

Full local browser verification of `80b3d0c9e` on 2026-10-16 passed 408
cases, skipped ten and failed three with one worker in 20 minutes:

- `packages/client/e2e/file-viewer-minimize.spec.ts`, “in the right pane,
  finds past a wide table and keeps its place on reload”: a scroll-position
  predicate expected greater than 3972 but remained 3944 for five seconds.
- `packages/client/e2e/mcp-app-view.spec.ts`, phone-width case: the first
  sequential typing assertion expected `S` but received
  `Plan a trip to OsloS`. The composer already contained draft text; this
  trace does not establish dropped input. Inspect fixture draft isolation
  before changing the input path or its 100 ms acknowledgement bound.
- `packages/client/e2e/provider-readiness.spec.ts`, “keeps stale Gateway
  display blocked until named retry succeeds”: a request-count predicate
  remained zero instead of reaching one within five seconds. Reproduce the
  controlled request sequence before attributing this to provider readiness.

All five project-app browser cases passed, including the new opt-in
auto-start visit. Quick checks, capability auditing and the separate relay
suite passed. Source CI passed for the same commit on both repositories:
[upstream CI](https://github.com/kzahel/yepanywhere/actions/runs/38967400635)
and [mirror CI](https://github.com/graehl/yepanywhere/actions/runs/38967408770).
That disagreement does not establish whether the local failures are flakes,
fixture leakage or product regressions. They were left outside the project-app
auto-start publication scope; no assertion or timeout was weakened.

Local screenshots and error contexts are retained under
`packages/client/test-results/25db954f-b5f7-4330-a12d-a9b0d1880f37/`.
Publication summaries are in `.artifacts/publish/run.mgNKmi/`.
Run these three specs independently and in their observed order, preserving
the existing assertions, before choosing fixes. See also
[shared fixture isolation](e2e-shared-server-isolation.md).

Found 2026-10-16 while finishing and publishing project-app auto-start.
Contributing-model: 6-Astra.
