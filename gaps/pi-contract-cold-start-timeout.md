# Installed Pi contract times out under full-suite load

`packages/server/test/e2e/pi-contract.e2e.test.ts` gives the installed Pi
CLI 10 seconds to answer `--version` on non-Windows hosts. In the full
workspace unit suite it exceeded that deadline and failed after 10.1 seconds;
an immediate isolated rerun passed in 7.4 seconds.

This was not fixed alongside unrelated provider-reader review findings because
raising the timeout without characterizing cold-start variance could conceal a
real Pi startup regression. A fix should measure loaded and isolated startup,
then give this external-runtime contract an evidence-backed deadline or move
the version probe out of the suite's peak contention window.

Found 2026-09-04 while running full-suite verification.

Reproduced 2026-09-07 during UI mockup export verification: workspace `pnpm
test` failed the installed Pi `--version` probe; the focused Pi contract passed
on rerun. The 10-second non-Windows deadline remains unchanged. This is a
suite-load-dependent failure, not evidence of a mockup export defect.
Contributing-model: 6-Astra

Observed 2026-09-27 during composer new-session dock verification: the full
workspace run failed both the installed Pi version probe and
`pi-effort-retry.e2e.test.ts` (expected a result, received an error), while
5,951 server tests passed. Both installed-Pi tests passed together in an
isolated rerun (12.26s total). No Pi or server production code changed in
this task. The full-suite failure remains unresolved; the retry test's
failure mechanism was not established.
Contributing-model: 6-Astra

Observed again 2026-09-08 during Codex incremental-read verification: the
full-suite installed-Pi probe failed after 10.8 seconds with empty version
stdout (`Unrecognized Pi version output:`), while an isolated contract rerun
passed in 7.1 seconds. The empty output's cause was not established; the
isolated pass does not make the full-suite result clean.
Contributing-model: 6-Astra

Observed again 2026-09-15 during shell-wait display verification: the full
workspace run failed only this server test, with empty version stdout;
5,283 other server tests passed. The isolated Pi contract passed in 10.7s.
The full-suite failure remains unresolved.
Contributing-model: 6-Astra

Observed 2026-09-28 during project-template placement mockup verification:
`pnpm test` failed the version probe with empty output and the effort-retry
case with `error` instead of `result`; 5,979 server tests passed. Shared,
relay and push-broker suites passed; the recursive run stopped at the server
failure. No provider/runtime files changed in the mockup slice. These failures
were recorded rather than changing installed-Pi behavior for a UI prototype.
Contributing-model: 6-Astra
