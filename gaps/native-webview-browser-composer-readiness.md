# Native webview browser fixture sometimes outlasts composer readiness

In [CI 36915742826](https://github.com/kzahel/yepanywhere/actions/runs/36915742826),
`packages/client/e2e/native-webview.spec.ts:105` exhausted its five-second
composer visibility check on the desktop case. The captured page snapshot
contained only `Loading…`. This happened before streaming or typing began;
the retry and phone case passed. All 24 CI jobs passed with this one retry.

This is separate from the simulator latency failure being repaired. Check
lazy-route readiness and initial native-fixture requests, then give functional
readiness a measured budget if needed. Keep the subsequent 100 ms input ceiling
unchanged. The project-app fixture already separates initial route readiness
from its final preview assertion.

Found 2026-10-01 while checking hosted iOS and main CI results.
