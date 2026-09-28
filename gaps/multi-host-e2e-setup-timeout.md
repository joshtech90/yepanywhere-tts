# Multi-host E2E setup times out under full-suite load

`packages/client/e2e/multi-host-secure-coexistence.spec.ts` gives each mode's
shared relay harness 15 seconds to start. The full browser suite timed out both
the legacy and mux `beforeAll` hooks before any cases ran. An immediate isolated
rerun passed all 14 cases, with the two setup paths taking 13.4 and 13.6 seconds.
An earlier verification run also observed this only in the full suite.

This was not fixed alongside unrelated review findings because simply raising
the timeout would hide the setup's narrow margin. A fix should identify the
contended startup step or establish an evidence-backed setup deadline that is
stable under the supported full-suite workload.

Found 2026-09-04 while running full-suite verification.

## Follow-up 2026-09-27

The two transport modes now share one three-host startup. The legacy
disconnect test waits for the stopped host to exit, and mux setup restarts
only that host. An isolated run passed all 14 cases in 1.1 minutes including
the shared E2E build. This removes one full startup from the spec, but does
not establish that the remaining startup meets its deadline under full-suite
load. A full CI run and, if it still times out, a measurement of the contended
stage are needed.

The first full-suite CI run with the shared setup passed all 14 cases in both
modes without retries ([run 36325789955](https://github.com/kzahel/yepanywhere/actions/runs/36325789955)).
One run does not establish that the historical load-dependent timeout is gone;
keep this gap open while collecting a comparable CI window.
