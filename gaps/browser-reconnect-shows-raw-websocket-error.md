# Browser session exposes a raw socket error during recoverable interruption

In the October 7 [browser/Android interruption study](../docs/testing/source-lifecycle-study-2026-10-07.md),
the real remote web client's session page briefly displays
`WebSocket closed with code 1006` when its initial reads are interrupted.
Observed with both direct and mux connections. The page recovers in place;
this is a network interruption, not a session content failure.

Reproduce with the opt-in lifecycle runner: `--client=browser --route=direct
--surface=session --fault=in-flight --observe-ms=30000` (also `--route=mux`).
The fixture holds real page reads, then the TCP controller drops the socket.
Mutation observations capture the transient error even if a screenshot misses
it. The server is still running and new connections are accepted immediately.

Investigate error classification through `RelayProtocol` and the session's
read/error rendering before reconnect status arrives. The broader
[conformance sketch](sketches/source-transport-lifecycle-conformance.md) should
cover both event orderings. Keep real server/application failures visible and
do not replay ambiguous writes. No production fix was made during the study;
first reduce this page observation to an owning-layer regression test.

Found 2026-10-07 while comparing browser and native connection recovery.
