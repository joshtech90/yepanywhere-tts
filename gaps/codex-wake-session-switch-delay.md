# Session switches can stall after waking a stopped Codex session

The September 9 report observed a fully delayed UI switch to a third session
after waking a second Codex Astra session. Other windows may also have been
affected. Resource checks on gra showed 83.4% available RAM, about 81% idle CPU,
and no swap-in/out during the diagnostic sample. These recovered-state samples
do not rule out pressure at the original stall.

Server logs from 00:31–00:34 UTC recorded session-detail requests around
2.95–3.51 seconds. One spent 2.94 seconds reading; later requests spent about
3.14–3.49 seconds in the remainder of the route, with only 7–24 ms reading and
no returned messages. The latter timing includes asynchronous waits; it does
not establish an event-loop block. Inspect the route's supported-command and
fresh child-session lookups, alongside provider activation and browser timing.
Activation is coordinated per session, and tunneled requests are dispatched
without serially awaiting preceding requests.

The same tab separately reproduced a global list shrinking from 100 loaded
rows to 50 on refresh, followed immediately by loading 100 again. Preserving
the loaded refresh window fixes that mechanism. After a client reload, a
six-second observation held 100 rows across 24 store notifications and the user
reported that flashing stopped. This does not close the original wake delay.

The granted tab also repeatedly emitted `Tool result for unknown tool_use`
while rendering this long conversation. Investigate tool-result pairing and
render repetition at the owning projection; do not suppress the warning. The
bounded performance snapshot after reload observed 21 long tasks in 25 seconds,
with a 91 ms maximum, and no multi-second main-thread pause. It cannot explain
an earlier stall that was outside the capture.

Related contracts: `topics/client-global-store.md`,
`topics/session-summary-fidelity.md`, and `topics/remote-browser-diagnostics.md`.
Existing restart and high-cadence investigations remain in
`gaps/sidebar-slow-after-server-restart.md` and
`gaps/cached-sidebar-high-cadence-catch-up.md`.

Found 2026-09-09 while fixing sidebar and composer flashing in the affected tab.
