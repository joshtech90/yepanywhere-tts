# Android secure transport and packaged artifact delivery

Status: accepted direction, implementation in progress, 2026-10-16.
Series: `android-secure-transport`.

The maintainer approved incremental commits, browser SRP regression protection,
Android reconnect/streaming improvements, emulator and physical-device fault
testing, and final artifact acceptance with large movies and many images.
Publication is separate from this implementation.

Current evidence: browser SRP's 32 cases and full workspace units pass. The
packaged API35/WebView124 app passes the public-relay baseline, a complete
movie/fault matrix and a focused twenty-image fault burst. The
[measured report](../testing/android-artifact-streaming-2026-10-16.md) distinguishes
those results from the aggregate-window and physical lifecycle work still
open. Three actual HOME/launcher cycles now retain the artifact/draft and each
show one recovery interval with fresh asset reads and no app errors. One earlier
103.2 ms emulator frame miss remains recorded. The broad browser run finished
with 406 passes, ten skips and five failures;
three repaired cases pass focused reruns, while the unrelated App sandbox and
WebRTC readiness failures remain recorded in the report. Native beta requests
now directly select connection-wide flow control. Three original eight-reader
128 KiB/s diagnostics reproduced relay circuit queue closure; the repaired
emulator run passes all eight 206 first chunks without closure or mux churn.
Final progress-reservation isolation and physical qualification are recorded in
the report: both full media/fault/warm/cold/reload matrices pass, as does the
phone eight-reader slow-link case without closure/churn. Both final public TLS
relay media matrices pass too. See the report for input clocks, throughput samples
and the still-unqualified long sleep/radio/source transitions.
See the measured report for the red baseline and its memory-sampling limits.
A separate parent reload reproduction exhausted the server preview lease cap
after fifteen successful restorations. The repair uses a bounded, source-bound
cleanup journal and browser locks with the existing DELETE route; eighteen
actual-app restorations and browser concurrent-owner checks now pass. No wire
contract or native artifact authority was added. Eighteen actual same-host
native-tab round trips also pass with explicit artifact reopening and draft/route
retention; inactive tabs retain navigation metadata, not their file-pane heap. One
forced process loss with an unread 64 MiB response also recovers the saved
pairing, route/draft and a fresh artifact read without credential injection.

## Accepted Android viewer design

Keep the bundled privileged UI at `https://appassets.androidplatform.net`.
Package the fixed managed-viewer bootstrap, service worker and helpers in the
APK, generated from the same sources as the hosted viewer. Reuse the existing
per-viewer isolated HTTPS origins, browser service worker, captured-source
parent broker and principal/session-bound server preview leases. Android's
native interception supplies only the fixed shell; it never fetches artifact
files or arbitrary URLs on behalf of untrusted content. Install the process-wide
ServiceWorkerClient once without retaining an Activity. Keep third-party cookies
disabled and the exact-origin main-frame native bridge unchanged.

This extends [plan 155](155-managed-artifact-viewer.md); it adds neither an
authentication principal nor a public bearer grant. Server-side authorization
and file containment remain authoritative. Explicit custom deployments retain
precedence. An explicit shell capability/version selects packaged delivery;
unsupported clients/servers retain their existing fallback. No privileged
parent-origin migration or independent native artifact fetch bridge is selected.

The isolated spike `669c09840` measured this shape on Android 17/API 37,
WebView 154, through fresh native pairing and the public encrypted relay.
Relative images, CSS, fonts, scripts, modules, JSON and linked HTML worked;
native authority was absent in content, parent access was denied, and worker
restart/cancellation and sequential typing passed. Its 64 KiB HTTP-range
adapter is experimental evidence, **not** the production streaming design.
That spike did not qualify large explicit/suffix ranges, movies or older WebViews.

## Existing work and limits

- [Source lifecycle conformance](../../gaps/sketches/source-transport-lifecycle-conformance.md)
  owns recovery contracts and the remaining shared-suite work.
- [October 7 hardening](../testing/android-lifecycle-hardening-2026-10-07.md)
  and the existing `packages/client/e2e/lifecycle-study/` harness provide real
  native/browser comparisons, outage gates, repeated wakes and bounded cleanup.
- [Warm resume](146-android-tabs-and-warm-resume.md) intentionally releases
  background native leases while retaining the document. One recovery edge
  is expected; the maintainer reports several rapid reconnect cycles on phone
  resume. Their cause is unproven, and final healthy state alone is insufficient.
- The duplicate-subscription gap now has a deterministic reproduction and repair:
  restore must finish before publishing the connected transport. It is not yet
  proven to cause the reported physical-phone UI cycles.

## 1 — Protect ordinary browser password login and SRP recovery

Establish the existing direct and relay full-password login, verified resume,
interrupted requests, subscription catch-up, cancellation and credential-scope
coverage. Add focused real-boundary checks only for missing regression risks.
Capture a passing baseline before changing shared framing or response delivery.
Preserve ordinary browser connection ownership and old-server compatibility;
Android work must not hand native credentials to JavaScript.

## 2 — Diagnose and repair Android resume state

Correlate foreground/document and lease generations, actual connection attempts,
native phase, bridge messages and client status. Reproduce controlled races
with deterministic scheduling before changing recovery. On device and emulator,
exercise repeated short resumes, longer sleep, in-flight reads, pending retries,
server/relay cuts and restoration. Distinguish socket churn from subscription
reattachment or stale UI state. No banner debounce hiding real failures.

One native owner coalesces recovery; obsolete work cannot publish over a newer
connection. Hidden/closed consumers release subscriptions, queued work and
timers. Terminal authentication failures stop; transient network failures keep
credentials. Verify missed messages exactly once, route/draft preservation and
all sequential input acknowledgements within 100 ms during concurrent updates.

## 3 — Deliver progressive bytes with bounded backpressure

Use the existing encrypted response stream protocol where available. Extend
native request/session and bridge interfaces for status/headers followed by
bounded body chunks, demand/credits and cancellation; avoid whole-file JSON or
base64 reassembly. Bound per-stream and aggregate queues and concurrent reads.
Cancellation, disconnect, backgrounding and document teardown release both
native and server producers. Keep control/chat traffic responsive beside media.
Do not blindly replay writes, or silently splice file generations after a cut.
Keep buffered JSON APIs and older-server behavior compatible.

## 4 — Integrate the packaged viewer

Generate and version shared shell assets, install application-owned interception,
advertise explicit availability and reuse the existing managed pane. Preserve
custom viewers, MCP frames, top-level link routing and fallback behavior. Test
two viewers/tabs, source switching, worker restart, Activity recreation, close
and resume without leaking file authority or process-wide callbacks.

## 5 — Qualify large artifacts under faults

Use owned YA profiles, relay/server processes, isolated test application data
and a separately identified browser/emulator. Never replace the user's installed
app or mutate its saved profiles. Keep screenshots, APKs and device selectors
out of Git. Use seeded reproducible faults and retain the seed/action timeline.

Prove the actual Android YA pane loads a page with at least 20 local images
and a large playable movie. Exercise open-ended, bounded, suffix and invalid
ranges, seeking, concurrent reads, slow consumers and mid-stream cancellation.
Check exact bytes/headers against the file, bounded memory/queues, prompt
producer cleanup and continued chat/typing. Repeat on emulator and the attached
phone with disconnections, relay loss, stalls and resume. Label untested engine,
server and release boundaries explicitly. Run required workspace/native gates,
review via an authorized Opus 5.5 high YA session, address findings, and record
the measured acceptance before calling this reliable.

## Progress

- [x] Accepted service-worker design and ordered qualification recorded.
- [x] Browser SRP regression baseline and startup handoff repair (32 cases).
- [ ] Resume diagnosis, regression repair and physical/emulator validation.
- [ ] Progressive native responses, backpressure and cancellation.
- [ ] Packaged viewer integration and lifecycle compatibility.
- [ ] Large-media/many-image acceptance, fault matrix and review.

## Measured progress

The initial unchanged browser password-login/SRP/relay run passed 31 of 32
cases in 1.9 minutes. Full login, verified resume after refresh/disconnect,
credential rejection/scope, relay recovery and a streamed download beyond the
single-message limit passed. The separate new-session startup typing case
lost its initial space; that remains under investigation, not a clean baseline.

Four deterministic native-bridge cases reproduce old reconnect completions
overwriting newer native states. A native state revision now prevents those
old successes/failures from publishing status. The four cases fail before the
repair; all 44 focused bridge/transport/subscription cases pass afterward in
4 seconds. This establishes a state-ordering defect, not the cause of the
maintainer's particular physical-phone observation. Device diagnosis remains.
Root lint (zero warnings), format, typecheck and the full unit suite pass
(6,999 client / 6,583 server; about 125 seconds). Native Rust baseline fmt,
tests and warning-denying clippy pass. Existing intentional negative-path test
logs and console-budget debt remain recorded in their existing gaps.

Progressive native responses now pass the real unchanged-server probes over
native direct SRP, relay mux and exact legacy relay: 40 MiB original bytes,
suffix ranges, concurrent ordinary requests and independent lease cancellation.
The body path uses bounded byte queues and pull-driven binary bridge replies,
not the spike's repeated HTTP ranges. Rust fmt/tests/clippy, Android JVM tests,
workspace lint/format/typecheck and the full unit suite pass (7,008 client /
6,583 server, about 123 seconds). Device and artifact qualification remain.
The Opus 5.5 high read-only review accepted the reconnect-revision fix and
identified further recovery/bridge-pressure races to reproduce and repair;
its recommendations are hypotheses until checked against the current code.

Resume regressions now cover native reachability independent of WebView online
state, one recovery interval across lease edges, five-second recovery coalescing,
late operation replies, native status reconciliation and coalesced lease
reattachment. The focused bridge suite passes 54 cases in 4 seconds. Android JVM
checks reproduce the duplicate subscribe before its repair and pass afterward;
a real encrypted TCP peer also reproduces cancellation of an admitted blocked
request disrupting sibling demand, and passes after preserving the frame write.
The bounded outbound queue drains 200 ordered events while prioritizing lifecycle
state and control, and releases blocked producers/budget on close. Rust fmt,
27 tests and warning-denying clippy pass. Further stream compatibility/admission
findings from the Opus review are being addressed before device acceptance.

The streaming review reproduced two defects against a real encrypted peer:
a 2 MiB buffered JavaScript response was rejected and an invalid body length
killed the source. Fallback now preserves the existing encrypted message bound;
stream-local errors cancel only that body, preserving ordinary sibling requests.
The JS bridge suite passes 59 cases, including twenty concurrent consumers,
queued cancellation/seek, a quiet read beyond 30 seconds, redirect/error parity
and pre-header resume retry. Native slots return on cancel or consumed EOF,
while completed unread buffers stay bounded. Media and catch-up alternate
behind small state/control messages. The physical isolated app's main probe
passed upload and sequential typing; its screen-wake test was blocked by secure
keyguard, so it is not accepted as a passing lifecycle run. No primary app data
was replaced. Emulator and unlocked-phone qualification continue.

Source-wide native FIFO admission now also prevents concurrent documents from
racing the eight-body limit; a real encrypted peer proves cancellation admits
the next body before the old native object is destroyed. Rust fmt, 31 tests
and warning-denying clippy pass; actual mux and legacy relay fixture checks
pass. Android lint/JVM checks and workspace lint/format/typecheck/full units
pass (7,016 client / 6,583 server; about 140 seconds). These are foundation
checks, not completed movie or device-lifecycle qualification.

A real encrypted-peer/storage schedule reproduces the actor-cancellation
credential gap. A per-profile credential barrier now orders old restoration,
snapshot visibility and a newer v5 proof; the same regression covers explicit
profile retirement and slot pruning. It fails before serialization and passes
afterward, preserving the invalidation/downgrade checks. A second controlled
regression proves catch-up is no longer held behind reconnect security check-in;
it times out before the repair and passes afterward. Rust's 32 tests and
warning-denying clippy and Android lint/full JVM suites pass. The maintainer's
exact phone banner sequence still needs device correlation.

A coalesced retry can leave only a connected observation from a replacement
socket. The new regression fails before adding a native connection epoch and
passes afterward: exactly one reattachment, no duplicate edge for the same
epoch and no regression from an older epoch. The focused bridge suite now
passes 60 cases. Native diagnostics retain only 128 phase/generation samples,
with monotonic timestamps and no message contents, paths or credentials.

The first complete isolated emulator foundation run passed direct (17 cases)
and mux/100 MiB (16 cases), including their intentional runner-owned/direct-only
assumption skips. The normal live probe's software-emulator allowance is not a
100 ms typing qualification; preserve actual input/paint timings separately.
The packaged actual-pane run on API35/WebView124 loaded the fragment graph and
blocked privileged navigation. One harness assertion used Chrome154's wording
for that refusal; after recognizing both engines' exact CSP diagnostics, the
run reached sequential artifact typing and measured 113 ms command round-trip,
above its 100 ms gate. Record event/input/paint clocks before attributing that
round-trip to UI latency or changing an assertion. These are failed qualification
attempts, not a passing artifact acceptance.

### Accepted native connection window — 2026-10-17

The maintainer clarified that Android is unreleased beta and approved a
coordinated native/server update without extra compatibility negotiation or
old-beta support. Native requests select `stream: "connection"` directly;
there is no response echo, new capability, or version-dependent native branch.
Ordinary browser requests retain `stream: true` and the existing per-response
window. SRP login, pairing, encryption and browser server compatibility remain
unchanged. The shared Rust native core is also used by the unreleased iOS app;
this implementation phase qualifies Android, not iOS artifact rendering.

One 1 MiB window covers all native response streams on a logical authenticated
connection. Completed and cancelled tails stay charged until the client
acknowledges bytes actually consumed or received and discarded. Cancelling a
producer does not pretend queued relay bytes have disappeared. Native end
markers settle cancelled tails; receipt deadlines and retained-entry ceilings
bound abandoned bookkeeping. The relay limits are preserved. A server can still
return an ordinary buffered response for non-streamed content. This is flow
control within the existing authenticated source, not a new principal or fetch
bridge.

The earlier proposal required an optional `streamWindow: "connection-v1"`
request and matching response echo, with old-native fallback. It was not
implemented and is superseded by this explicit beta decision. The earlier
stable-corpus audit remains historical evidence, not an approval blocker.
The maintainer also authorized emulator substitution if the physical phone
locks again and confirmed Claude reviewers may be used with bypass permissions.

The next actual-pane attempt recorded trusted key-event timestamps through
input and animation frame, while retaining per-key value checks. Artifact:
32 characters, 9.2 ms max input / 21.4 ms paint / 61 ms command RTT. Composer:
33 characters, 5.8 ms input / 17.9 ms paint / 171 ms command RTT under live
updates. This demonstrates control-plane RTT was the failing clock in that
attempt, not a dropped/late painted keystroke. Android acceptance now gates
every real trusted input/paint sample at 100 ms and reports command RTT
separately; desktop retains its existing additional round-trip gate. The
attempt remains recorded as failed under its original assertion.


The browser leading-space failure now has a controlled hook reproduction:
ref/layout adoption edits before passive draft hydration; whitespace-only text
is omitted from durable storage and the first hydration read erased it. The
regression fails before the guard and passes afterward while preserving new-key
hydration (26 focused draft/preboot cases, under one second). Full browser
login/relay and startup handoff verification are still required.

The next large-media attempt failed on a genuine server crash: Node 26.7.0's
Readable.toWeb file adapter enqueued after its controller closed during media
cancellation. A 300-iteration standalone cancellation loop did not reproduce
that exact timing; the actual-pane crash remains the evidence. Opened authorized
file responses now use 64 KiB pull-driven positional reads and a cancellation
latch, also shared with mutable file responses. Range/descriptor/cancel/truncated
file checks pass (27 cases, under one second). The actual-pane rerun is pending;
this repair is not yet a completed media qualification.


The repaired browser login/SRP/relay suite passes all 32 cases in 1.8 minutes,
including the original startup leading-space case and large transfer/recovery
checks. Workspace lint, formatting and typecheck are clean; full units continue.
The new single-hook regression costs 35 ms with its existing preboot suite.

After the opened-file cancellation repair, the actual packaged API35/WebView124
pane passed the public encrypted relay media matrix: twenty distinct PNGs,
100,663,296 exact prefix bytes, a 150,254,465-byte/600-second H.264 movie,
bounded/suffix/open-ended SHA-verified ranges and 416 length metadata. Seeking
reached 150.16, 450.17, 60.20 and 594.16 seconds; after 65 seconds paused,
playback resumed at 300.25 seconds with 640×360 decoded pixels/72 sampled colors.
Artifact typing painted all 32 characters within 20.2 ms; the composer painted
all 33 within 13.1 ms during transcript updates and playback (maximum command
RTT 106 ms, reported separately). Five exact Chrome124 denied-sensor diagnostics
and the single intentional 416 diagnostic were classified separately; no other
console errors occurred. Whole-device captures were individually inspected and
presented through artifact capture, kept out of Git.

That run still failed its newly added lifecycle tail: live updates removed the
original link from the virtual transcript. The first attempted fixture correction
did not actually insert its new tail row; a second narrow run therefore failed
on the same missing link. The fixture now explicitly appends the row and the
registration event history confirms all three earlier viewers were removed.
Do not call either run complete acceptance. Eighteen fresh admissions/removals,
seeded real-socket faults, memory/queue qualification and unlocked physical
media/lifecycle testing remain. The Opus sessions did use tools under bypass
permissions, but the Claude monthly spending cap now prevents a fresh final
review; their earlier findings have been applied without changing account limits.


The first full unit run after positional-reader integration correctly failed
on seven unclosed FileHandles from small responses whose callers inspected only
headers. A zero-read-ahead body had delayed all I/O/EOF until consumption. The
reader now retains one bounded 64 KiB chunk and proactively closes on the
selected range's end, preserving the previous small-unread-response lifecycle.
A real-file regression checks descriptor closure before consuming retained
bytes. All 28 focused file/preview/mutable-response cases pass in 0.45 seconds;
the full suite is being repeated without suppressing the GC ownership errors.


The next full unit run passed all server cases without the descriptor errors
(6,589), then caught seven client failures from the new viewer subscription.
Native's status snapshot is stable, but local/multiplex implementations compute
fresh objects and use bound class methods. The viewer now subscribes through
the transport receiver and snapshots only the primitive packaged-version value.
All 120 existing viewer/rendering cases across five suites pass in 2.83 seconds,
including delayed native capability arrival. The subsequent full workspace run
is in progress; neither failed run was accepted as green.
