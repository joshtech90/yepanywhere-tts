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

The same desktop composer-readiness failure recurred at line 156 in
[CI 37691081022](https://github.com/kzahel/yepanywhere/actions/runs/37691081022)
on `8610677ef`. Its retry passed; the subsequent input ceiling remains
unchanged. This is still an open fixture/readiness diagnosis.

Found 2026-10-01 while checking hosted iOS and main CI results.

2026-10-08: the completed first browser shard of `37699374414` on `c33fe7c6f`
again reports one retry at the desktop composer's five-second visibility
assertion, with 194 other cases passing. The remaining superseded workflow was
canceled after final-source CI started; this completed retry evidence remains.
