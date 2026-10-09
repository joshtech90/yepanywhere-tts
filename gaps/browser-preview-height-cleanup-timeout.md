# Real-browser preview-height test can time out during cleanup

During the Android subscription repair on macOS ARM64, the full workspace
unit run passed all 6,792 client assertions but failed the `afterAll` hook in
`ToolCallRow.preview-height.test.ts`: closing its page/browser exceeded the
10-second hook budget. The preceding full run passed. The captured failure is
`tasks/source-lifecycle-study/subscriptions-all-tests.log` in the local study
artifacts; no runtime warning or application assertion failed.

An isolated diagnostic with `DEBUG=pw:browser` passed in 2.45 s, with the
assertion and hooks taking 514 ms and a recorded graceful browser exit. No
owned Chromium process remained afterward. That does not identify or repair
the full-suite cleanup stall. Preserve the next full-run failure's browser
process/close trace before changing the timeout. The original run overlapped
an Android build and emulator study, which is a possible source of contention,
not an established cause. No arbitrary budget increase was made.

Found 2026-10-07 while validating Android subscription cancellation and errors.
