# Android packaged artifacts and native streaming — 2026-10-16

Status: shared-window repair, slow-link and large-media acceptance pass on the
actual phone and emulator, including public TLS relay and owned fault tests.
The final qualification below supersedes the historical red baseline. Remaining
coverage limits stay explicit. Nothing was published.
[Plan 156](../tactical/156-android-secure-transport-and-artifacts.md) owns the
remaining work. The [security contract](../../topics/active-content-security.md#bundled-android-fixed-shell)
owns observable behavior, authority, limits and fallback.

## Test boundary

Tests used the actual bundled, minified Debug app on an owned Android 15/API35
ARM64 emulator with WebView 124.0.6367.219. The side-by-side artifact test package
has no production app-link filters. Every run refused an existing test install,
created temporary YA/profile/file data, paired through the real native UI,
verified the app's captured-source viewer and removed only its owned app,
forwards/reverse ports and server/relay processes. The installed primary app's
profiles were untouched. Screenshots, APKs, credentials and private selectors
are not repository artifacts.

There were two network boundaries:

- Public `wss://relay.yepanywhere.com/ws`, with a disposable identity and normal
  TLS/SRP/encrypted transport. The APK supplies its four fixed viewer assets;
  it does not use a hosted artifact tunnel.
- An owned local relay, reached by the native socket through an ADB reverse and
  a TCP fault gate. This leg uses loopback WebSocket plus the normal SRP/NaCl
  encryption, not TLS. The YA server connects directly to that owned relay;
  faults affect the native client's real socket. WebView network emulation
  would not exercise this connection.

The native interceptor supplies no artifact bytes or file authority. The same
browser service worker and trusted parent broker used by the web viewer obtain
bytes through authenticated, principal/session-bound preview leases. The
privileged main frame remains at appassets; artifact frames have no native
bridge and cannot embed the privileged parent. Fixed shell routing has a JVM
security matrix; the real pane verifies the isolation and navigation boundary.

## Passing emulator matrix

| Boundary | Measured outcome |
| --- | --- |
| Actual public-relay pane | PNG/srcset, CSS/background assets, WOFF2, classic scripts, static/computed modules, exact JSON/binary/empty files and range metadata pass. |
| Fragment compatibility | Theme, widget state across inner reload, bounded follow-up insertion without submission, find and real sequential typing pass. |
| Navigation and workers | Linked HTML, reload, explicit worker termination/restart and inert network fallback pass. |
| Warm launcher resume | Three real HOME/MAIN cycles (1 / 2.5 / 1 s background) each show ready→connecting→ready once, retain parent/artifact identity and draft, and read a fresh asset with status 200. No application console errors. |
| Whole-parent reload | After lease cleanup repair, eighteen restorations pass with new parent/artifact identities and removal of all old worker registrations. |
| Native same-host tabs | Eighteen round trips destroy both selected WebViews, retain the session route/draft and app process, and explicitly reopen an artifact with a new parent/origin and a fresh 200 asset read. |
| Cold process restart | After consuming 65,536 bytes of a 64 MiB response, force-stop and launcher restart replace the process/document, retain route/draft, and reopen a fresh artifact using saved native credentials. |
| Pane teardown | Eighteen successive fresh admissions pass, beyond the 16-live-leases-per-principal cap. Each has a new origin/storage context and its worker registration is removed on close. |
| Large media through owned relay | Twenty distinct local PNGs and a real 150,254,617-byte H.264 movie (600 s, 640×360, 12 fps) pass. A 100,663,296-byte prefix matches a bounded-buffer SHA-256 digest tree. |
| Range fidelity | A 65,536-byte bounded seek at byte 50,000,000, an 8,191-byte suffix, an open-ended final 2 MiB and an invalid range match exact bytes/status/Content-Range. The invalid response retains `bytes */N` with status 416. |
| Playback | Real user activation starts playback; seeks reach 150.17, 450.19, 60.16 and 594.20 s. After 65 s paused, playback resumes at 300.25 s. A presented-frame callback and 72 sampled pixel colors establish decoded video, beyond metadata-only success. |
| Interrupted body | Cutting the real socket after the first 65,536 bytes of a 16 MiB response fails that body in 124 ms. Another queued 65,536 bytes arrive before failure; it does not silently splice/replay the response. A fresh artifact read succeeds. |
| Seeded recovery | Seed `156202610`: disconnect, 2,329 ms connection refusal and 3,171 ms silent stall recover. The disconnect observation lasts 2,002 ms. Draft retention, one visible recovered update and restoration of the same artifact document pass. |
| Images during faults | A separate focused run queues twenty local image reads during each of those three faults. All sixty recovered responses match their expected SHA-256 bytes. It intentionally omits the full prefix/pause media matrix, which passed separately. |
| Movie retry | Playback works again after the network faults using a fresh media request and a real play gesture. |

The full media/fault run showed two visible recovery intervals: one for the
initial cut/immediate second cut, and one for refusal. The short silent stall
needed no visible reconnect. This is a measured schedule, not proof that the
maintainer's particular physical-phone resume sequence is resolved.

The transcript assertion parks the covering modal before inspecting catch-up,
then restores it and checks document identity. Covered transcript rendering is
intentionally frozen under the existing
[covered-viewer gap](../../gaps/covered-viewer-live-transcript.md). DOM mutation
counts during typing do not establish that a covered transcript advanced.

## Typing and diagnostics

Every test types sequential trusted characters, checks each retained prefix,
and records event creation, input and animation-frame acknowledgement. Each
sample must remain within 100 ms. Android CDP command round-trip time is
reported separately; desktop retains its existing additional round-trip gate.

| Run | Artifact: 32 characters, max input/frame | Composer: 33 characters, max input/frame |
| --- | --- | --- |
| Public-relay complete baseline | 9.7 / 30.7 ms | 6.8 / 17.2 ms |
| Complete movie/fault run | 4.3 / 15.0 ms | 16.8 / 23.9 ms |
| Focused twenty-image fault bursts | 11.9 / 22.6 ms | 26.1 / 28.4 ms |
| Public-relay warm-resume run | 7.5 / 17.8 ms | 5.4 / 18.6 ms |
| Repaired reload/fault/warm combined run | 10.5 / 32.4 ms | 21.5 / 26.7 ms |
| Native tab-disposal run, before tab cycling | 8.3 / 20.4 ms | 8.2 / 23.8 ms |
| Cold-process run, before termination | 26.7 / 54.6 ms | 20.6 / 24.3 ms |

The complete movie run appended 33 concurrent review updates while typing.
Its command round-trip maxima were 108/279 ms, while event/input/frame clocks
passed. The emulator foundation runner's historical 2,000 ms software-renderer
allowance is **not** this strict typing qualification.

An earlier owned-relay attempt missed the unchanged frame gate at **103.2 ms**
for composer key 22. It remains a failed qualification attempt. Later runs
passing do not explain that miss or establish its absence under every load.
The manual recorder now preserves bounded long-task and per-key evidence on a
failure. Physical-device timing and further reproduction remain necessary.

Chrome 124's built-in video controls register an orientation listener; sensors
remain denied. The runner separates only that exact diagnostic from app errors,
and separately recognizes the explicit invalid-range probe's exact 416 resource
diagnostic. It keeps every other console error fatal. The
[pinned Blink implementation](https://chromium.googlesource.com/chromium/src/+/refs/tags/124.0.6367.219/third_party/blink/renderer/modules/media_controls/media_controls_rotate_to_fullscreen_delegate.cc)
explains the listener. Whole-device captures were visually inspected, including
actual colored video pixels, and presented through artifact capture.

The warm-resume run's command RTT maxima were 41/124 ms under eighteen live
updates. Android reported `document.visibilityState === "visible"` even while
the OS confirmed the app had left the resumed Activity. Native foreground and
lease state, rather than DOM visibility alone, must own this boundary. These
three short launcher cycles do not qualify phone sleep/wake or process death.

## Defects exposed and repaired

- A browser startup leading space was erased when ref/layout adoption preceded
  passive draft hydration and whitespace-only storage read back as empty.
  The controlled regression fails before the repair; new-draft hydration still
  works. The unchanged browser login/SRP/relay matrix then passes all 32 cases.
- Movie cancellation crashed the server in Node 26.7.0's Readable.toWeb adapter
  after a controller closed. Authorized file responses now use bounded
  positional reads with a cancellation latch. A 300-iteration standalone loop
  did not reproduce the original timing; the actual-pane crash is the evidence.
- A zero-read-ahead first implementation leaked descriptors for small unread
  responses inspected only for headers. The full suite caught seven GC errors.
  One bounded 64 KiB chunk plus proactive EOF closure fixes that ownership path;
  a real-file regression checks closure before consuming retained bytes.
- A warm-resume attempt retained the artifact and draft through three cycles
  and read fresh assets, but failed acceptance on settings GETs reporting the typed expected
  reconnect interruption as errors. The settings owner now retains its snapshot
  and lets the connection indicator own that transient read state. A controlled
  red/green regression preserves genuine read failures and failed writes, and
  verifies reconnect revalidation without mutation replay. The fresh actual-app
  run passes, including banner edges and eighteen more teardown cycles. One
  intervening attempt failed only the harness's OS Activity-field parser; the
  corrected parser requires a recognized resumed Activity outside the test app.
- The first new viewer status subscription assumed all transports returned
  stable, unbound snapshots. Seven existing local/relay viewer cases failed.
  The viewer now subscribes through the receiver and snapshots only the primitive
  packaged-version value; all 120 focused viewer cases and full units pass.

Native resume/credential, catch-up, writer-cancellation, source admission and
coalesced-state repairs are recorded in plan 156 and their commits. Existing
Rust real-peer tests cover per-body queues, FIFO admission, cancellation/EOF,
credential serialization and unchanged-server fallback. Kotlin queue tests
cover state/control priority, bounded event pressure and media/event fairness.
These bounds do not establish a shared bound over cancelled relay tails.

## Eight-reader slow-link reproduction — 2026-10-17

Two isolated actual-app runs requested eight 16 MiB ranges from the generated
movie, read one chunk from each response that started, and retained unread
bodies for approximately 20.5 seconds. An owned TCP gate limited downloads to
128 KiB/s per physical connection while preserving upload progress; this was
not WebView network emulation. Neither relay limits nor production framing was
changed. Both runs failed the opt-in diagnostic: the relay's `relay_closed`
circuit counter increased by one. Four requests returned 206 and four 504 in
the first run; five returned 206 and three 504 in the repeat. Every successful
first chunk contained 65,536 bytes. This is not full-range completion evidence.

The repeat's passive counters recorded **no physical mux close or reopen**
during the burst. Observed incoming message maxima remained 66,843 bytes from
the server and 1,569 bytes from the client, below the default 2 MiB frame cap.
Given the current mux close paths, those observations isolate the circuit
closure to the queue-limit path; this attribution is an inference from the
observed counters and implementation, not a newly emitted subreason. One live
circuit means its 2 MiB ceiling is reached before the 8 MiB socket queue cap.
The relay also counted twenty additional invalid requests during the burst;
their individual contents were not recorded.
After cancellation and removal of throttling, a fresh artifact read returned
200 and the owned app was removed.

Both runs began with the relay circuit `relay_closed` counter already at two.
The repeat additionally observed two physical mux closures before the stress
phase. A later owned-relay run with `--trace-native-setup` resolves the setup
boundaries: before pairing, zero circuits/physical sockets had opened or closed;
once the paired home rendered, two had opened and one had closed; after the
harness's explicit top-level session navigation, three had opened and two had
closed. First artifact readiness leaves those counts unchanged. Pairing closes
its temporary authenticated transport, and full document navigation releases
its document-owned native lease. This attributes the measured setup closures
to those explicit boundaries, rather than spontaneous artifact-open churn; it
does not diagnose the maintainer's physical-phone resume sequence. The stress
closure delta above remains separate.

Eleven main-process PSS samples per run peaked at 133,318 KiB and 145,068 KiB,
respectively. The second ranged from 143,663 to 145,068 KiB. These short samples
exclude isolated WebView renderers and do not establish aggregate memory bounds
or cleanup of all downstream buffers. The test stores bounded diagnostic data,
not complete movie bodies. Its rate-control regression verifies exact ordered
bytes, independent upload progress and cancellation of a pending pacing timer.
Gate teardown also now waits for all owned upstream and downstream sockets.

The versioned connection-window proposal remains approval-pending. This red
baseline gives it a real-device-path regression target; it does not authorize
a contract edit or justify raising the relay's existing limits.

A final audit on the rebuilt app after the lease-cleanup repair remains red:
two readers return 206 with 65,536-byte first chunks and six return 504 over
20.6 seconds at the same rate. The relay circuit closure counter increases by
one, and this attempt also records one physical mux close/reopen. The earlier
no-physical-close inference applies to that earlier run only. Cancellation and
removal of throttling again permit a fresh 200 asset read. Eleven main-process
PSS samples range from 135,010 to 137,027 KiB, excluding isolated renderers;
they do not prove aggregate memory bounds. The opt-in runner exits nonzero and
removes its owned installation. Lifecycle and lease repairs have not resolved
this sustained multi-reader transport failure.

## Parent document reload reproduction — 2026-10-17

Two corrected actual-app runs restored an admitted artifact through fifteen
whole-parent document reloads, each with a new parent time origin and fresh
artifact origin. Old worker removal was observed for all fifteen. The next
restoration fell back to the scriptless viewer. The second run's independent
same-principal admission probe received **429 “Too many open previews”**, which
establishes exhaustion of the server's sixteen-preview cap. It is not a worker
registration leak or evidence of successful server lease cleanup.

An initial harness attempt waited for a transcript link after the first reload,
even though the modal had restored successfully and intentionally froze the
covered transcript. That attempt does not establish a connection failure. The
corrected test inspects the restored artifact directly and closes the modal
before its final transcript assertion. No product assertion was relaxed.

`ManagedArtifactPreview` releases admitted leases on React effect cleanup, but
whole-document destruction does not run that cleanup. Native navigation also
closes the old bridge at `onPageStarted`, so asynchronous unload-time API calls
cannot be assumed to finish. Client recovery must remember admitted lease IDs
for the captured source and reclaim only abandoned owners using the existing
authenticated DELETE route, preserving concurrent live artifacts. No new route,
wire field or privileged native artifact broker is needed. The tested WebView
exposes Web Locks; browser lock termination on document unload offers a basis
for distinguishing active owners from discarded documents without guessing a
hidden-tab timeout ([specification](https://w3c.github.io/web-locks/#termination-of-locks)).
The source-bound cleanup repair now passes eighteen actual-app restorations
over the public encrypted relay. A final rebuilt app also passes sixty image
reads across the three seeded faults, fresh movie playback, three real launcher
resumes (one recovery interval each), eighteen explicit viewer closes and
eighteen parent reloads in the same run, with no application errors. This
focused run omits the separate 96 MiB/pause movie matrix. Its artifact/composer
command RTT maxima are 271/235 ms; trusted input/frame maxima remain within
100 ms as shown above. Owned packages and processes are removed after each run.

Two CI browser cases use real same-origin pages, storage and Web Locks with a
controlled HTTP transport facade. Eighteen peer reloads preserve another live
owner and serialize concurrent journal writes. Source mismatch causes no
request; failed DELETE remains recorded, authoritative 404 settles it, and an
arbitrary stored API path is discarded without a request. These tests exercise
client bookkeeping, not server authentication. The full actual desktop YA
viewer also passes over the public encrypted relay, including concurrent
origins and survivor refusal after close. All 24 focused browser cases pass
in 50.7 seconds, including existing custom-deployment/settings behavior.

The owning security contract documents journal/lock limits, unavailable-browser
fallback and the remaining crash window before an admission response is
received/recorded. Server expiry bounds that unknown lease. No privileged native
artifact broker or new wire field was added.

## Native tab disposal — 2026-10-17

The actual app passes eighteen same-host round trips between a new Projects tab
and the artifact's session, through native accessibility controls. Each
selection closes the old DevTools page; both WebViews are discarded each round.
Returning creates a new parent document, retains the draft and session route,
and explicitly reopening the HTML creates a different artifact origin and
reads a fresh JSON asset with status 200. The native app process stays the same.
This runs beyond the sixteen-preview cap and passes with no observed application
errors. Setup, the ordinary pane checks and eighteen round trips took about
4 minutes 15 seconds; this remains an opt-in device acceptance, not a per-case
addition to the default browser CI suite.

The first attempt incorrectly required automatic inline-pane restoration and
failed after returning to a healthy session. Plan 146 promises bounded inactive
tab navigation state, rather than retention of the JavaScript heap; all eighteen
measured returns required explicit file reopening. No production behavior was
changed to satisfy this test. The initial failed expectation is not evidence of
a transport or admission failure. Both attempts removed the owned app afterward.

No previous worker was reported by the replacement target's CDP observer after
discard, but a new target's observation is not a complete global registration
inventory. Explicit-close and parent-reload registration removal have stronger
separate evidence above. This same-profile test does not qualify a different
profile or active-artifact Activity recreation; the separate cold-process case
below supplies one narrower process-loss result. Initial
sequential input in this run passed at the clocks above; it was not typing while
the native tab-selection dialog was open.

## Abrupt process loss — 2026-10-17

One actual-app public-relay run force-stops the owned test package with a
64 MiB file response unread after its first 65,536-byte chunk. A credential-free
ACTION_MAIN launcher start creates a different process and parent document.
The selected session route and draft return, and explicit file reopening yields
a different artifact origin, working modules and a fresh JSON read with status
200/expected data. No new username/password, pairing dialog or credential
injection is supplied after the stop. The application consumes and clears App
Link data during the original pairing. No application errors are observed, and
the owned installation is removed afterward.

This establishes one ready-viewer process-loss/recovery boundary, including
persisted native pairing and client cleanup metadata. It does not establish a
full 64 MiB transfer, exact producer/descriptor state at the moment of death,
process death during admission/resume rotation, or the reported physical-phone
reconnect sequence. Inline file-pane state is reopened explicitly, consistent
with the navigation-only cold restoration above. The input clocks in the table
were sampled before process termination, not while the process was absent.

## Verification and remaining limits

Workspace lint, format and typecheck pass; full units pass with 7,022 client
and 6,595 server cases. Rust's 32 tests/fmt/warning-denying clippy and Android
BundledDebug JVM/lint/build/instrumentation compilation pass. The earlier
isolated actual-app foundation runs pass direct (17 cases) and mux/100 MiB
(16 cases), including their declared runner-owned/direct-only skips. A fresh
isolated mux main-app probe also passes: 100 MiB uploaded, 3,559
bridge frames / 106,451,685 bytes, 1,053,190-byte measured queue high water,
zero overflows, 23.5 ms maximum typing acknowledgement. Its sanitized status
proof records one initial CONNECTING→CONNECTED epoch, native credit latency
p50/p95 3,515/28,138 µs and main-thread dispatch 32/194 µs. This upload probe is
not aggregate movie-stream memory evidence.
The broader browser run finished with 406 passes, ten skips and five failures
in 16.8 minutes. Two native-WebView failures exposed lost recovery demand inside
the five-second cooldown; a controlled regression fails before retaining one
attempt for the cooldown boundary. The repaired desktop/phone browser-fixture
cases pass in 53 seconds, with 68 real keys at 20 Hz/1 MiB incoming frames and
15.2/13.4 ms maximum frame acknowledgement. This is a browser bridge fixture,
not physical Android evidence. Full units and the actual Android main-app probe
pass after that repair.

The other broad-run failures were process-app startup requiring Linux/Bubblewrap
on this macOS host, opportunistic WebRTC device streaming against the generic
native-app emulator, and a context-menu test expecting macOS Control-click to
open a page. A separately identified Chromium probe confirms Control-click
emits only contextmenu on macOS while Meta/Shift clicks open pages. The test now
uses the primary platform modifier and separately checks macOS Control-click
context suppression; the focused check passes in 25 seconds. The remaining
[App sandbox](../../gaps/e2e-local-instructions-and-project-app-failures.md) and
[WebRTC readiness](../../gaps/opportunistic-emulator-webrtc-readiness.md)
findings are tracked separately. No full-green browser result is claimed.

Unqualified or pending:

- Long physical sleep/doze remains unqualified. The phone is available again,
  and actual-app media/fault, warm-resume and cold-process evidence is below.
- The original independent-window slow-link failure is repaired by the native
  connection window recorded below. Only sampled main-process PSS is available;
  no aggregate process-memory high-water bound is established. Unit bounds are
  not aggregate device-memory evidence.
- The current native tab implementation keeps one active WebView; selecting a
  different native tab saves history and destroys the old document. Two live
  artifact documents across native tabs are not supplied by that topology.
  Repeated parent reload is repaired and qualified as recorded above.
  Same-host artifact tab disposal/reopening is qualified above. Different-profile
  artifact source switching, active-artifact Activity recreation, process death
  during admission/resume rotation, long half-open sockets and physical
  radio/route transitions remain unqualified. The ready-viewer cold-process
  case above is narrower evidence.
  Sequential viewers and worker restart are narrower evidence.
- The source/generated APK uses 256 MiB per file, 1 GiB produced bytes per viewer
  and a 120-second progress deadline. The currently deployed hosted worker keeps
  its earlier 64 MiB file limit until separately published. Old-server and custom
  viewer fallbacks retain their existing limits.
- No iOS/WebKit or Tauri implementation/qualification is implied.
- The earlier reviewer account limit was lifted. Fresh Opus 5.5 high review
  used bypass permissions and real tools; its final pass found no serious
  accounting/deadlock issue. The owned reviewer was verified stopped afterward.

Reproduction commands and ownership safeguards live in
[artifact-host/README.md](../../artifact-host/README.md#packaged-android-acceptance)
and [the native testing guide](../development/testing.md). Raw receipts/captures
remain in ignored `.artifacts/managed-artifact/`, not in this report or Git.

## Shared native connection window — 2026-10-17

The maintainer approved a coordinated unreleased native/server beta update,
without the earlier proposed response-echo negotiation or old-native mode.
Native selects `stream: "connection"`; browser requests retain `true`, and
all 32 normal browser login/SRP/relay cases pass again (1.8 minutes). The shared
window is 1 MiB, including completed/cancelled tails until receipt ACKs.
Each of eight reader slots reserves one 64 KiB piece, while a lone stream
borrows spare capacity up to 576 KiB before an ACK. A paused body does not stay
at the connection FIFO head. The initially tried fixed 128 KiB per-body ceiling
was replaced after review identified its latency/throughput cost. Receipt and
send-wait
deadlines retain a 15-second margin over native's 120-second idle discard.
These are body-byte limits, not an aggregate process-memory claim.

Opus 5.5 high reviews ran through YA with `bypassPermissions` and real Bash/grep
access. Review-driven repairs cover FIFO fairness, browser deadline isolation,
earned-progress timer renewal, duplicate IDs, late starts after an abandoned
head, and preserving space for sibling readers beside a paused body. Thirteen
focused server cases and 35 Rust tests/clippy pass. The new encrypted-peer
regressions require final consumption ACK after end, cancelled-tail receipt ACK,
and adoption/ACK of a late start after head abandonment. Live Rust source-lease,
mux and login/resume tests also pass.

An intermediate minified emulator app passed the former red reproduction:
eight 206 responses with 65,536-byte first chunks at 128 KiB/s over 20.5 seconds,
no new relay closure, no physical mux close/reopen and fresh status 200 after
cancellation. Eleven main-app PSS samples ranged from 141,024 to 144,830 KiB,
excluding renderers. Its full movie/range/fault/warm/cold/reload matrix also
passed. These receipts predate the final reservation rule; final qualification
is recorded separately, rather than treating them as tests of later code.

The first Pixel 7a/API37/WebView154 run also passed all eight transport readers
and post-cancel read without relay closure/churn, but failed the final console
assertion on five exact denied-accelerometer diagnostics from native video
controls. This remains a failed acceptance attempt. The harness now records
that same known exact refusal separately on the two measured engines (124 and
154); sensor permission stays denied and other application errors remain fatal.
An earlier emulator attempt was blocked by a stale bundled build's update
banner intercepting a link click; preparing matching frontend/APK inputs fixes
that test setup. Neither attempt is discarded from the evidence.

A subsequent phone full-matrix attempt passed media and all seeded transport
faults but failed when the harness tried to tap a composer covered by the viewer
iframe. No app errors were recorded. Composer qualification now uses the real
minimize control, types with live transcript updates while retaining the loaded
artifact, restores it and verifies the same document identity. It does not
force a tap through the overlay or replace the artifact. Actual typing and
presentation timings remain mandatory.

### Final coordinated-beta qualification

The final minified app passes the full owned-relay matrix on both API35 /
WebView124 emulator and Pixel 7a / API37 / WebView154. Each run verifies twenty
image hashes, a real approximately 143 MiB movie, a bounded-memory 96 MiB prefix
digest, explicit/suffix/open-ended/invalid ranges, four seeks and presented
pixels. During the 65-second pause, twenty fresh image reads complete with exact
hashes, then playback resumes. This is actual media behavior; the server
regression separately holds a producer unread to prove the reservation invariant.

| Run | 96 MiB prefix verification | Artifact max input / frame | Composer max input / frame |
| --- | --- | --- | --- |
| Emulator, owned encrypted relay | 12.54 s (7.65 MiB/s) | 11.4 / 24.3 ms | 13.4 / 33.3 ms |
| Pixel 7a, owned encrypted relay | 29.68 s (3.23 MiB/s) | 5.1 / 19.6 ms | 9.1 / 22.1 ms |
| Emulator, public TLS encrypted relay | 8.74 s (10.99 MiB/s) | 6.3 / 23.9 ms | 5.4 / 20.6 ms |
| Pixel 7a, public TLS encrypted relay | 34.90 s (2.75 MiB/s) | 9.0 / 25.1 ms | 12.8 / 28.5 ms |

Prefix time includes the byte checks and bounded-buffer digest work, not just
wire transfer. These single-run measurements are not a controlled bandwidth or
RTT benchmark; no general throughput parity claim follows. The server regression
proves nine 64 KiB-sized pieces can be sent before any ACK, avoiding the rejected
one-chunk window. Non-aligned producer pieces plus a tiny retained tail expose
reservation loss at retirement; after it retires, all seven sibling readers
finish while the large body receives no ACK.

Both full owned-relay device runs also pass the body-cut case (no implicit
splice), the seeded disconnect/refusal/stall burst with twenty images per fault,
three HOME/launcher cycles with one ready→connecting→ready interval each, eighteen
fresh viewer closes, an abrupt cold process restart and eighteen parent reloads
beyond the sixteen-live-leases cap. Route/draft, saved native pairing and fresh
artifact access survive their intended lifecycle boundaries. Inactive/cold file
pane reopening remains explicit; native tabs do not retain live WebViews.
No app console/page errors occur; the exact browser sensor denials stay separate.
The maintainer's original intermittent resume sequence was not reproduced as
reported, so these results qualify the measured cases and repaired races.

The final phone slow-link acceptance also passes eight 206 first chunks of
65,536 bytes over 22.05 seconds at 128 KiB/s, with no new relay circuit closure,
no mux close/reopen and a fresh 200 read after cancellation. Eleven main-app
PSS samples span 250,352–309,618 KiB, excluding isolated renderers. Its input/frame
maxima are 5.4/32.2 ms inside the artifact and 15.3/39.6 ms in the composer.
All temporary packages and owned processes/ports are removed after these runs.

Physical typing uses the loaded viewer's normal minimize/restore controls and
retains document identity. Clearing the draft already focuses the native input;
a second CDP click raced the physical IME resize and is removed. The actual
keyboard is dismissed through Back only when its current shown flag is true.
Reading the whole IME diagnostic previously exceeded the subprocess buffer;
the harness now collects only that flag and drains the producer, preserving no
input history and avoiding the initial early-pipe-close diagnostic. These
failed harness attempts remain distinct from passing device acceptance.

The final public TLS-relay phone matrix passes too, including twenty paused
image reads, ranges/seeks/presented pixels, three warm launcher cycles and
eighteen viewer closes. Its actual OS screenshot shows the full typed draft
above the visible native keyboard; the focused input bounds are inside the
visual viewport. This provides OS-level evidence alongside CDP captures made
during physical IME resize. No temporary test installation remains.

The final exact-source emulator slow-link run passes all eight 206 first chunks
in 20.46 seconds, with zero new relay closure or physical mux close/reopen,
post-cancel read 200 and eighteen viewer closes. Sampled main-process PSS ranges
from 150,386 to 152,851 KiB; artifact input/frame maxima are 11.5/18.5 ms and
composer 9.1/17.5 ms. These are the final reservation rule's results, separate
from the intermediate fixed-window experiments above.

Final workspace lint, formatting and typecheck pass. Full units pass with
7,022 client and 6,595 server cases (declared skips retained). The touched
stream-stall negative tests capture and assert their expected diagnostic;
unrelated failure-path warning debt remains recorded in the existing gap.
Android unit/lint and the minified four-ABI APK build pass; 35 Rust tests,
format/clippy and the three live lease/mux/login cases pass. The normal browser
SRP/login/relay rerun passes 32/32. Final review found no serious unresolved
flow-control issue; the owned Opus reviewer was stopped with resume blocked.
