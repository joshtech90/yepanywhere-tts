# Git-status route tests can time out in the combined workspace suite

Six cases in `packages/server/test/routes/git-status.test.ts` exceeded their
five-second deadlines during a combined workspace run: no-op and real push,
advancing and no-op pull, recorded fetch time, and editor attribution.
The same source passed all 29 cases when the file ran alone (8.8 seconds total),
and an earlier server-suite run also passed. Contention is a hypothesis, not a
proven source-level defect.

Reproduce with subprocess timing before changing deadlines or route behavior.
Keep the test's operation deadline meaningful under the suite's declared host
and concurrency budget. Left outside the browser measurement change because
it does not touch server Git execution.

Found 2026-09-13 while verifying bounded development measurement retention.
