# Android host battery profile and headless lifecycle, 2026-10-18

The Pixel 9 received the idle artifact-state fix, an explicit relay keepalive
profile, and debug native controls usable through authorized ADB without
opening an activity. This is bounded integration evidence, not qualification of
unattended remote wake or ten-second encrypted application readiness.

## Deployment and idle writes

The physical phone used wireless ADB and was genuinely unplugged. Its ordinary
host already had a battery-optimization exemption; its independent Lab did not.
No exemption, radio, debugging listener, endpoint, remote-access enablement or
provider credential was changed. Both had no active provider processes before
runtime replacement. Native APK updates used each installed app's existing
signer. The Lab signing key stayed on the phone.

The deployment replaced only the built ArtifactServer and RelayClientService
modules and shared host profile, then restarted through the owning native
service. It was not a fresh whole-runtime payload installation. The artifact
fix is commit `c52e07e39`. On the ordinary host, `grants.json` retained the same
inode, modification timestamp, size and SHA-256 across **83.2 seconds** idle.
Private selectors, credentials, hashes, APK backups and raw logs remain local.

## Controlled scheduling gap on the physical phone

A private local WebSocket fixture exercised the actual deployed
RelayClientService in the Lab's real Node/PRoot process. After observing its
first wire ping, the fixture blocked Node's event loop for **75.019 seconds**
with `Atomics.wait`. The ordinary host remained available. This is an event-loop
stall, not evidence that Android suspended the CPU.

Measured from the end of the pause using the phone's monotonic clock:

| Case | Observation |
| --- | --- |
| Existing default profile | Timeout path at 167 ms without a fresh ping; registered again at 1.298 s. |
| Battery profile, live socket | Fresh ping at 159 ms, matching pong at 253 ms; retained its socket. |
| Battery profile, unanswered fresh ping | Ping at 164 ms, timeout at 5.166 s, replacement registered at 6.228 s. |
| Battery profile, pending deadline delayed by the pause | New probe at 146 ms; old pong at 250 ms did not replace the current probe; matching new pong at 599 ms retained the socket. |

The stale-pong refusal is additionally tested with no matching replacement pong,
where the five-second deadline still expires. Focused scheduling tests also
cover a backward wall-clock change and cancellation on connection handoff.
An initial physical run paused before the first ping because registration took
longer than expected; it was discarded for the scheduling-gap comparison above.

The fixture used plaintext local WebSockets and registration/probe handling,
not the public TLS relay or a complete SRP/encrypted browser session. Retaining
or registering a socket is a narrower boundary than application interactivity.
All temporary probe imports/files were removed and original launch files were
restored byte for byte before the hosts were restarted.

## ADB-only lifecycle and authorization

On the physical phone, `host.py control` successfully stopped, queried, started
and restarted the ordinary host while another application remained focused.
The focused window and display wake state were unchanged. The local credential
was unchanged, authenticated readiness returned, and the configured relay
returned to `waiting`. Restart produced a different launch generation.
Observed controller wall times were 11.1 s for stop, 2.8 s for status, 13.1 s for
start and 16.7 s for restart; these include ADB/controller overhead and full
server startup, not demand latency for an already running host.
Force-stopping the Lab and starting it again through the protected shell path
also returned authenticated readiness while preserving the ordinary host's PID
and API availability.

A separate fixture application UID, without `DUMP`, attempted explicit service
control and provider snapshot access against both installed hosts. All four
operations threw permission refusals naming `android.permission.DUMP`. The
probe opened no activity, requested no provider turn and was uninstalled after
its run. Merged manifests confirmed both components exported with that
permission in Debug and non-exported in Release. Same-app controls continue to
use the existing single service owner and state provider.

The physical screen-off lifecycle commands themselves completed, but the phone
woke during the run, so that attempt does **not** establish display-off
preservation. A pending screen-off/Doze relay measurement was cancelled before
its first demand or forced-Doze phase to avoid interfering with handheld use.
Its launch-file restoration and authenticated restarts completed. No passing
unplugged Doze, natural suspension or remote-demand result is claimed here.

An owned, isolated API 35 ARM64 emulator then ran the real provisioned
Node/PRoot server. Status → Start → Restart → Stop → Status → Start all returned
the expected native states while every post-command power snapshot still
reported `Asleep`. No activity was launched, no UI input was used for lifecycle,
and no keyguard was dismissed. Its transport used Machine Control's neutral ADB
provider: the physical-handheld adapter intentionally rejects emulators. The
emulator ran with a read-only AVD overlay and was shut down afterward. This
establishes screen-off control in that emulator, not phone suspend or battery
behavior.

## Validation and limits

The profile retains the existing 30-second ping cadence. Desktop/general server
launches keep the default profile; Android explicitly selects `battery`, with a
private development override for comparison. This changes scheduling-gap
recovery, not the number of regular pings. No battery-drain reduction has been
measured. A silently broken connection between probes can still take roughly
30 seconds plus probe/reconnect time to recover, exceeding the desired
approximately ten-second demand target. There is no new wake lock, alarm, push
or unattended restart policy.

Android Debug/Release builds and Debug lint passed; lint reports no issues.
The real Alpine smoke passed protected API rejection, frontend/SQLite readiness
and restart persistence. Focused relay/environment tests passed 42 cases;
Android profile tests passed both cases. Python tools compiled. The ordinary
headless path does not require an unlocked display, but still requires already
authorized ADB, decrypted user-0 app storage and a provisioned debug host.

Root lint, formatting and typechecking passed in an isolated checkout of this
task's changes. All non-Android unit workspaces passed, including **7,050 client**
and **6,627 server** cases (73 server cases skipped). The server suite was rerun
after the separate rendezvous test-harness repair `c1f9b38c3`; this avoided
testing a moving shared tree. Client and final server suites took 155.83 s and
122.56 s respectively. Workstation checks ran on macOS. Existing unrelated
negative-path test diagnostics remain recorded in
[the warning debt](../../gaps/unit-failure-path-log-warnings.md); no global
warning filter was added. No Windows execution or physical suspend qualification
is implied.
