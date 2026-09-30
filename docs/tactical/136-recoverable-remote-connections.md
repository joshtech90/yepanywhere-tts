# Recoverable remote connections and evidence-based resume failures

Status: implemented 2026-09-29. Authorized 2026-09-29.

## Evidence and scope

An overnight relay client missed heartbeats, exhausted ten reconnect attempts,
and ignored a subsequent visible event because its manager was disconnected.
Manual Retry resumed the saved session successfully. Separately, the client
labels a five-second resume response timeout as protocol incompatibility and
can clear the credential and redirect to login without a server rejection.

The existing `gaps/background-relay-reconnect-blank-page.md` is distinct: that
incident recovered transport but lost the app shell. `tasks/` has no matching
local plan. This stability repair does not reprioritize the release roadmap.

Keep the existing exponential backoff and reconnecting UI. Distinguish an
exhausted rapid retry budget from a terminal failure internally. Preserve the
source transport as recovery owner after initial authentication; connection
establishment remains in the remote context and route gate. No server protocol,
authentication authority, capability, or compatibility-floor changes.

### 1 — preserve resume failure evidence

Introduce client-owned typed resume errors for timeout, explicit rejection,
proven incompatibility, and verification/protocol failure. Carry causes through
relay wrapping. Never infer authentication rejection from arbitrary message
substrings. Timeouts and unknown failures retain saved credentials. Explicit
rejection explains why login is required; verification failures stay blocked.
Preserve credentials while a relay resume is in flight, including global
stored credentials and per-host storage.

### 2 — keep exhausted connections recoverable

After the existing rapid retry budget, remain reconnecting with a paused/slow
recovery phase. While visible, probe at a bounded approximately one-minute
cadence with jitter; while hidden, stop slow probes. Visibility restoration,
focus, online, and user interaction can request recovery through the same
owner. Coalesce requests and rate-limit repeated signals. Stop/dispose and
terminal errors cancel all recovery work. Do not clear the remote context or
its transport subscription merely because a retry budget expired.

Initial connection failures retain the route and session and can retry on
renewed activity or a visible slow probe. Never run that recovery concurrently
with an attached transport's recovery. Explicit Retry remains available.

### 3 — verify policy and frontend ownership

Use fake time/visibility for budget exhaustion, morning return, visible probes,
hidden quiescence, concurrent signals, stale completions, and teardown. Exercise
resume phases through scripted sockets, including timeout followed by valid
proof, direct and relay paths, explicit rejection and invalid proofs. Add a
frontend integration harness with the real provider/transport/gate and controlled
socket boundary to assert credential persistence, route continuity, and live
subscription recovery. Reuse existing protocol compatibility tests.

### 4 — prove real relay recovery and publish

Add one focused real-relay browser regression with a test-owned fault boundary.
No production server fault endpoint. Verify recovery after exhaustion, fresh
live data and preserved input with sequential typing. Capture changed error UI
at desktop and phone sizes using repository capture helpers. Update the source
transport contract. Run focused tests, lint, format check, typecheck, unit tests,
console scan, and affected browser suites. Commit with model provenance, push,
and verify the pushed commit's required CI and hosted-client publication.

## Acceptance

- No unanswered handshake, transport failure, or retry exhaustion deletes a
  resume credential or claims that the server rejected it.
- A retained source automatically recovers after an outage without reload/login.
- Recovery has one in-flight attempt and bounded scheduling; hidden exhausted
  clients, stopped sources, and closed tabs do not keep probing.
- Explicit rejection and cryptographic failure remain distinguishable and do
  not weaken verification or protocol pinning.
- No new server contract is required; existing supported protocol versions
  retain their checks.

## Implementation and validation record

The policy lives in `ConnectionManager`, `resumeErrors`, and `remoteErrors`.
`MultiplexSourceTransport` retains the terminal typed cause for the context;
the gate and host picker show that evidence rather than interpreting text.
Both global credentials and saved-host sessions survive unanswered resumes.
Attached pages keep their transport and component tree throughout exhaustion.
Initial acquisition listens for focus, online, visibility, and slow probes;
interaction recovery belongs to attached transports, so a pointerdown cannot
unmount the initial error dialog before its action button receives a click.

The regression layers are fake-time manager tests, real resume handshakes over
scripted sockets, and a real provider/transport/gate/storage integration harness.
Existing compatibility tests still cover authenticated version pinning and bad
proofs. One added full-app browser case crosses the actual relay and server,
exhausts ten retries through a test-owned socket boundary, then checks resume,
a live encrypted pong, preserved input, and sequential typing during health
traffic. The case takes approximately 4–5 seconds locally; it reuses the
existing relay fixture and adds no production fault hooks or server endpoints.
The browser clock accelerates timers but resets wall time before creating an
authenticated proof, preserving the real server's timestamp checks.

Validation includes workspace unit tests, lint, formatting, typechecking,
console scan, and the relay, direct-login, session-startup, and legacy/mux
multi-host browser suites. Desktop and phone captures of the explicit rejection
were inspected. CI remains the full-browser-suite gate for the pushed commit.
The adjacent macOS sandbox fixture failures recorded in
`gaps/macos-sandbox-test-assumptions.md` were repaired in a separate test-only
commit; no production server code or wire protocol changed.
