# The dev wrapper's fallback process-group reap has no automated coverage

`reapRuntimeProcessGroup` in `scripts/dev.js:369` is the wrapper's last-resort
sweep for provider runtime process groups: it runs from
`stopProviderRuntimeHost` after the host has been asked to shut down, and it is
the only code that signals an owned group directly.

No test reaches it. Probed 2026-09-19 by throwing at the top of the function and
running `test/scripts/provider-host-ownership.test.mjs`,
`provider-host-system.test.mjs` and `dev-reload.test.mjs`: all four tests still
passed. The ownership test's `wrapper-loss` mode kills the wrapper outright, its
`foreground` mode relinquishes the group to a separate owner, and when the
wrapper does own the host the host reaps its own workers first, so the sweep
normally finds the group already gone.

Not fixed in place because there is no seam: `scripts/dev.js` exports nothing
and starts the dev server on import, so the sequence can only be exercised by
spawning the wrapper and arranging for the host to leave an owned group behind —
a new fixture rather than an extension of an existing test. The cheap version is
a wrapper started with a fake provider host that reports a process group and
then exits without reaping it, asserting the group dies and that the wrapper
exits 0 when the group disappears between the liveness check and the signal.

Found 2026-09-19 while remediating harsh-review a08cc4a9..69501d94 item 59
(doubled liveness checks in that function).
