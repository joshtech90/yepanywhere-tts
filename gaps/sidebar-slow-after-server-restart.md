# Sidebar session list can take over a minute after restart

The September 7, 2026 report observed at least a minute before the sidebar
populated after a plain YA restart. The same incident exposed archived recap
forks after session-metadata truncation; atomic metadata replacement fixes that
data-loss mechanism, but is not evidence that the list latency is fixed.

The successful replacement logged retained-provider reattachment in 1,725 ms
and started listening about 2.7 seconds after startup began. The preceding
generation was replaced again before completing startup. A 30-second request
timeout/retry remains a user hypothesis, not an established cause. Server logs
also showed individual Codex fork-summary/detail reads taking seconds during
list recovery. A warm global list request during diagnosis took about six
seconds, without controlled contention measurements.

Trace the next slow restart through browser request timing, global-session
routes, session indexes, and Codex fork-history reads before changing resume
or retry behavior. Distinguish initial provider reattachment from list
hydration, and coordinate with the session-reader/async-question work in
`topics/session-summary-fidelity.md`. Do not hide same-title sessions to reduce
list work: they may be independently active sessions.

Retained collection mode now serves saved catalog rows without waiting for
provider discovery or optional question badges; the real route test serves
twenty requests while discovery is deliberately blocked. See
`topics/session-catalog-observation.md` for the contract and work-count checks.
The reported live restart still needs a browser timing check after the user
restarts with this change. Keep that verification open: the isolated checks
prove work separation, not an end-to-end latency bound on the affected tab.

Found 2026-09-07 while fixing metadata loss exposing recap-helper duplicates.
