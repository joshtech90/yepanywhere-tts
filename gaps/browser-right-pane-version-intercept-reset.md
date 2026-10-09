# Browser right-pane test can fail in its version-route interception

General CI `37712171641` on `a079aa3f9`, browser shard 2
(`113100340539`), reports a flaky
`e2e/session-right-pane.spec.ts:20` (tool discovery, resizing, parking and
typing). Its `page.route("**/api/version*", ...)` callback failed at line 48:
`route.fetch: read ECONNRESET` while fetching the owned fixture's `/api/version`.
The retry passed; the shard reports 191 passed, 3 skipped and 1 flaky.

The visible stack and summary are retained as
`tasks/android-hardening-round2/ci-a079-browser-two.txt`. This is a failure in
an intercepted fixture request; the available log does not establish whether
page shutdown, fixture lifecycle or another condition reset the connection.
It is not evidence that Android lost its native session or that the right-pane
product assertion itself failed.

Reproduce the route callback with the existing fixture and inspect worker/server
lifecycle alongside page closure. If cancellation is established, join or retire
the intercepted request correctly. Do not swallow arbitrary fetch failures or
weaken the pane and sequential-input assertions. This browser-test investigation
is outside the current Android transport repair.

Found 2026-10-08 during Android internal-release verification.
