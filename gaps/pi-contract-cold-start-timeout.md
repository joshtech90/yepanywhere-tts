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

Observed again 2026-09-08 during Codex incremental-read verification: the
full-suite installed-Pi probe failed after 10.8 seconds with empty version
stdout (`Unrecognized Pi version output:`), while an isolated contract rerun
passed in 7.1 seconds. The empty output's cause was not established; the
isolated pass does not make the full-suite result clean.
Contributing-model: 6-Astra
