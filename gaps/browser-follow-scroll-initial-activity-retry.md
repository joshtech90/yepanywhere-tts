# Follow-scroll activity test sometimes misses its initial bottom assertion

In [CI 36911014222](https://github.com/kzahel/yepanywhere/actions/runs/36911014222),
`packages/client/e2e/selection-during-activity.spec.ts:384` failed its initial
following-state assertion: `fromBottom` was 252 px rather than below 4 px.
The failure occurred before the held-button action, and the retry passed.
All 24 CI jobs passed, but this run was not free of browser retries.

The native-webview desktop/phone typing tests passed on their first attempts.
This separate follow-scroll finding is outside the iOS CI repair. Diagnose
the activity update and scroll acknowledgement ordering before changing its
oracle; the existing held-selection scroll-jitter gap concerns a later state.

Found 2026-10-01 while checking hosted iOS and main CI results.
