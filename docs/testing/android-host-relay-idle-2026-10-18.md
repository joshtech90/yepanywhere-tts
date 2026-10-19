# Android host idle writes and relay sleep timing

Diagnostic evidence from 2026-10-18. This is a short physical-device experiment,
not overnight survival or a battery/power benchmark.

## Artifact state

The preceding Pixel 9 audit observed an identical `artifacts/grants.json`
replacement across a 66-second idle sample with no grants or pending deletions.
The artifact expiry sweep ran every 60 seconds and saved even unchanged state.

The fix skips unchanged saves, including empty startup and restoration of live
grants. Expiry, borrowed and owned revocation, delivery-address invalidation,
and completed deletion work still dirty the state. Failed saves are retried by
a later sweep. Expired requests return 404 while leaving cleanup to the sweep;
creating a grant also settles outstanding expiry work.

Real-filesystem regression coverage verifies unchanged inode/mtime across
sweeps and restart, no empty startup file, retry after a failed atomic save,
expired-state persistence, owned cleanup after an expired request, and persisted
borrowed revocation. The focused grant/store run passed 19 tests in 0.85 seconds;
the final repeat passed as well. Repository lint, formatting, type checking,
and the full non-Android workspace test suite passed on macOS. Linux/Windows
validation of this source change was not run. This experiment did not deploy
the artifact fix to either phone.

## Physical relay setup

- Pixel 7a, Android API 37, connected over USB; installed experimental host.
- Real foreground service, Alpine/PRoot, Node v24.18.1, real YA server process;
  no active provider processes before restarting it.
- A temporary import in the host entry created another instance of the
  installed production `RelayClientService`. Its implementation had the same
  30-second client ping, 10-second pong deadline, and greater-than-60-second
  drift check as the source under investigation.
- A private LAN WebSocket fixture acknowledged registration and automatically
  answered client pings. For the Android sleep run it also sent server pings
  every 60 seconds with a 30-second pong deadline, matching relay defaults in
  `packages/relay/src/config.ts`. This bypassed public TLS, authentication,
  pairing, and encrypted application traffic.
- Instrumentation logged client ping/pong, status, timeout, wall-clock and
  monotonic timestamps, plus independently observed relay traffic. It added no
  recurring sampling timer. Continuous resource profiling was temporarily
  disabled in this test process.

## Screen-off and forced Doze

The phases were 75 seconds awake, approximately 95 seconds screen-off with
Android battery charging simulated as unplugged, 105 seconds forced deep Doze,
and 40 seconds after wake. Android confirmed `Now forced in to deep idle mode`
and still reported `IDLE` at the end. No device polling occurred within the
screen-off or Doze waits; the workstation observed relay traffic independently.

| Observation | Result |
| --- | --- |
| Client pings | 11 |
| Client-side intervals between pings | 30,004–30,021 ms |
| Client-side ping-to-pong latency | 14–145 ms |
| Relay connections during the measured phases | 1 |
| Relay reconnects or keepalive timeouts | 0 |

Forced Doze did **not** produce a delayed client timer in this setup. USB stayed
attached, and the host had a foreground service; this is not evidence of kernel
suspend or of unplugged overnight behavior. It does not explain or reproduce
the earlier Pixel 9 log entries showing 67–69-second gaps since the last ping.
It does establish that ordinary screen-off and forced Doze need not disrupt
this particular host's short-run relay availability.

## Controlled event-loop pause

Signal-based process suspension under PRoot was inconclusive and is excluded
from the timing conclusions. A separate clean run instead blocked the real
host's Node event loop with a bounded 75-second `Atomics.wait`, starting after
its first successful client ping/pong. The fixture's server-originated
heartbeats were disabled for this phase so its own timeout could not decide
the outcome. This simulates a delayed event loop; it does not establish how
Android actually suspends the process.

| Observation, measured on the client clock | Result |
| --- | --- |
| Event-loop pause | 75,005 ms |
| Elapsed since previous ping at keepalive timeout | 79,953 ms |
| Resume to keepalive timeout | 33 ms |
| Resume to registered/waiting again | 1,123 ms |

The fixture retained the original socket throughout the pause. On resume the
client invoked its keepalive timeout **without sending another ping**, closed
that socket, and established a replacement. The relay observed the client's
normal close handshake, then another registration 1,017 ms later. The new
connection subsequently completed another client ping/pong.

This reproduces the drift rule independently of packet loss: a gap greater
than 60 seconds makes the client replace the waiting socket before probing
its current liveness. The existing 10-second pong deadline is a separate path.
The measured reconnect was brief in this LAN fixture; public relay, TLS,
radio transitions, and real suspension may change recovery time. No relay
policy change is included in this fix.

## Cleanup and limits

The temporary entry was restored byte-for-byte, temporary probe files and LAN
listener were removed, battery simulation and forced idle were reset, and the
previously running host was started again. Saved remote configuration and
credentials were not changed. Private device selectors and raw logs remain in
ignored local experiment directories.

Relay scheduling remains unchanged by this work. The client and relay both
originate heartbeats on a waiting connection; it is not a zero-work idle mode.
This report measures that waiting connection only, not active remote sessions.
