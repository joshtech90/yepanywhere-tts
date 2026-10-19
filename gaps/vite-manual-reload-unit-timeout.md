# Vite manual reload browser test can time out in the full unit suite

On 2026-10-14, `pnpm test` on macOS with Node 24.19.0 timed out the
`requires an explicit reload before importing changed source in manual mode`
case in `packages/client/src/lib/__tests__/viteDependencyCache.test.ts` at
its default 5,000 ms budget. A Gradle APK build was running alongside it.
The next manual-reload notification case observed three fetch calls instead
of one. All other client tests and the server suite passed.

The same three-case file then passed alone in 1.28 seconds, with 918 ms of
test execution. An earlier full run on Node 26 also passed. These runs show an
intermittent failure, but do not isolate its cause. The first case starts Vite
and Chromium and exercises navigation plus reload under the same overall
budget. Continued asynchronous work after its timeout may explain the two
extra calls seen by the following test's fetch spy; this remains unconfirmed.

A subsequent full Node 24 run without concurrent Gradle work passed all 6,970
client tests in 114.81 seconds and all 6,558 server tests in 109.30 seconds.
That clean rerun does not establish the cause of the earlier timeout.

This Firebase configuration task does not change Vite reload behavior. Keep
the browser assertions intact; measure startup and test phases under full-suite
load, verify cleanup after a timeout, and follow
[test time budgets](../topics/test-time-budgets.md) before changing its budget.

Found 2026-10-14 while tracking public Android Firebase client configuration.
