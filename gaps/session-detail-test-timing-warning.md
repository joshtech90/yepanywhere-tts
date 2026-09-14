# Session detail tests can emit a wall-clock warning

During the parallel workspace test run, the Grok redirect fixture in
`packages/server/test/routes/sessions-metadata.test.ts` emitted
`SESSION_DETAIL: slow request`: total 267.6 ms, augmentation 263.9 ms.
The route's production threshold is 250 ms in
`packages/server/src/routes/sessions.ts`. All 109 tests in that file passed;
an isolated rerun also passed without warnings.

The warning prevents claiming a warning-free workspace run. Contention is a
possible explanation, not established performance evidence. Do not suppress
the production diagnostic or raise its threshold just to quiet tests. A
follow-up should reproduce the augmentation timing with resource evidence and
decide whether the fixture needs controlled timing or the route needs work.
This was left outside the Codex retry change because it concerns a different
provider's session projection and did not reproduce in isolation.

Found 2026-09-08 while validating capped Codex overload retries.
