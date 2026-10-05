# Android WebView App With Native Login And Transport

Topic: mobile-server-pairing

Status: Android implementation complete 2026-09-30. Native login, full bundled
web foreground, host switching and duplicate native screen retirement are
implemented. Validation and remaining release acceptance are recorded below.

## Outcome

Opening the complete bundled web interface from an authenticated Android
profile should enter the application without another username/password prompt.
The bundled client will use a custom `SourceTransport` over an exact-origin
Android message channel. Kotlin remains the sole owner of SRP, resume material,
route selection, encryption, connection capabilities, and reconnect.

The full bundled web UI is the normal post-login application. Native screens
remain responsible for login, reauthentication, saved hosts, host selection,
and platform notification controls. The existing native dashboard and
Conversation presentation are removed from normal navigation during migration
and deleted after the new path is verified; their transport and shared data
code remain reusable. No hidden dashboard subscriptions should survive.

Native management, foreground work, and the WebView are logical consumers of
profile-scoped process-level connection managers. Each owns a lease, local
request namespace, subscriptions, and cancellation scope. Eligible profiles
may share a physical relay-mux socket without sharing SRP or source state. No
new YA server route, capability, child credential, or server-visible session
type is required.

Related contracts:

- [Mobile server pairing](../../topics/mobile-server-pairing.md)
- [Mobile companion app](../project/mobile-companion-app.md)
- [Client source runtime topology](../../topics/client-source-runtime-topology.md)
- [Source transport](../../topics/source-transport.md)
- [Trusted client packaging](../../topics/trusted-client-packaging.md)
- [Android native connection foundation](081-android-native-connection-foundation.md)
- [Server message routing](../project/server-message-routing.md)
- [Relay client multiplexing](../../topics/relay-client-mux.md)

## Fixed boundaries

- The initial mobile release supports server-owner login. Native limited-user
  sign-in and separate relay-server/SRP-user identities are explicitly deferred
  by the maintainer on 2026-10-01 and do not block the first mobile release.
- The privileged transport exists only for the bundled app-assets origin, in
  its main frame, and only while its owning document and Activity are alive.
  Hosted-`latest` continues to perform ordinary web SRP.
- `window.yaNative` remains a small control plane. Its current 16 KiB request
  guard does not apply to application transport and must not be raised merely
  to fit uploads or transcript responses.
- The bridge exposes source operations, not raw relay messages. Web code cannot
  set connection-wide capabilities, browser-profile metadata, wire request
  ids, transport sequence numbers, or authentication state.
- Kotlin never returns the password, resume key, transport key, or a delegated
  bearer credential to JavaScript.
- Speech is deferred. A later native speech implementation may own a dedicated
  ephemeral speech connection because current speech state is socket-scoped.
- An independently authenticated bundled WebView remains a possible later
  optimization or advanced mode. It must use an explicit normal SRP login and
  its own browser-scoped resume session unless a separately reviewed delegated
  credential contract is approved.
- Native multi-host demand and relay-mux ownership are an implementation
  prerequisite. Host selection is presentation state, and the bridge must not
  introduce one mutable global native connection.
- Native issues opaque document-scoped source handles. Every data-plane
  operation is scoped to one handle; stale-document and forgotten-profile
  handles fail without being rebound to another profile.
- Android initially carries full-WebView, media, and 64 KiB upload traffic over
  the profile's mux circuit, including when it is the only circuit. Pixel
  contention measurements, not anticipation, decide whether a later dedicated
  socket optimization is warranted; `NativeSourceTransport` does not expose
  the physical choice.

## Message and streaming contract

The existing 16 KiB `NativeHostProtocol` limit protects only small JSON control
requests. Application messages use a distinct protocol with these properties:

- fixed-size binary bridge frames, initially targeting at most 64 KiB of data
  plus a small header;
- a feature handshake that prefers ArrayBuffer frames and permits bounded
  base64 string chunks on older WebViews without binary-message support;
- logical message id, frame sequence, byte offset, end marker, and cancellation;
- byte-credit acknowledgements and bounded per-WebView queued/in-flight bytes;
- one coalesced UI-thread drain rather than one unbounded callback burst;
- explicit limits and failures for malformed metadata, inconsistent offsets,
  queue overflow, and document replacement; and
- metrics for bytes, frames, queue high-water, p50/p95 latency, main-thread
  drain duration, cancellations, and overflow.

Fragmentation bounds the bridge and UI-thread queues. It does not claim that
JSON parsing is incremental: the current encrypted WebSocket protocol seals
each JSON response or event as one message, so Kotlin must receive and decrypt
that logical message before routing it. Large transcript responses require
representative memory and latency testing. A failure caused by WebView
backpressure must release only the WebView lease.

### Uploads

Uploads retain the existing relay upload protocol:

1. JavaScript sends a small `upload_start` operation with filename, MIME type,
   size, and destination.
2. It reads the browser `File` stream incrementally. Local chunks reserve
   24 bytes for upload metadata within the 64 KiB bridge payload.
3. Each chunk crosses the bridge as an ArrayBuffer when supported; Kotlin adds
   the existing UUID/offset binary-upload header, encrypts it, and sends format
   `0x02`. A bounded base64 compatibility frame is allowed only when the
   installed WebView lacks ArrayBuffer messaging.
4. Local byte credits stop the file reader when the bridge queue is full;
   OkHttp queue high/low-water marks stop it when the network socket falls
   behind.
5. Server progress and completion events resolve the existing upload API;
   abort or teardown cancels the upload and releases buffered chunks.

These chunks provide bounded streaming, not cross-connection resume. If the
socket is lost, its server-owned upload state is discarded and the upload
fails; an explicit retry starts from byte zero. Resumable uploads would be a
separate capability-gated server feature.

A 100 MiB upload therefore produces bounded chunks, each carrying at most
65,512 file bytes locally. Browser stream boundaries may introduce additional
small chunks. Kotlin never needs a 100 MiB byte array. Each encrypted wire chunk adds 66 bytes before WebSocket or
relay-mux framing: 24 bytes of upload id/offset, one inner format byte, a
24-byte nonce, a 16-byte secretbox authenticator, and one envelope-version
byte. Bridge framing adds another small local header and no base64 expansion on
the normal binary path. The older-WebView string fallback does incur base64
expansion and is measured separately rather than treated as the normal
performance path.

Blob/download results use the same bounded fragmentation across the local
bridge. The current server relay path nevertheless reads the full binary
response and base64-encodes it inside one JSON response before Kotlin receives
it. Eliminating that wire-level whole-response and base64 cost requires a
separate capability-gated server contract and is not hidden inside this
client-only adapter. Normal JSON requests, responses, and subscription events
may span multiple bridge frames without inheriting the control channel's
16 KiB limit.

## Implementation plan

### 1 — prove native multi-host and relay-mux ownership

Before adding the WebView data plane, keep several profile managers demanded
concurrently, group eligible relay profiles below them, preserve exact legacy
fallback, and prove isolated connect/retry/reauthentication/revocation. Treat
the selected profile as presentation state. Exercise ordinary and full-session
traffic through the same logical circuit without exposing its physical relay
choice to consumers.

This prerequisite is tracked in
[tactical 084](084-android-native-multi-host-runtime.md).

Completed 2026-08-03. The attached Pixel proved two disposable YA profiles on
one physical local-relay mux, isolated circuit removal/failure, persistent
inclusion policy, exact production-relay fallback, and cleanup without
disturbing its three existing profiles. Bulk traffic was deliberately not
claimed by that prerequisite: the representative response and upload
benchmarks remain gates for steps 6–8, when this transport supplies an actual
bulk consumer.

### 2 — make native login and host selection the app shell

Reuse the existing pairing and reauthentication forms and server-management
controls. Persist the selected native profile, open the bundled WebView after
selection/login, and reopen native host management from the web Switch host
action. Hosted-latest keeps its existing independent browser login channel.
Do not copy saved web credentials, mint child sessions, or change relay defaults.

### 3 — bind the WebView to a native source handle

Pass the selected paired profile into `WebClientActivity`, mint a
document-scoped source handle, acquire a dedicated connection-manager lease,
and release it on document replacement or Activity destruction. Keep profile
selection and navigation Android-owned.

### 4 — establish the exact-origin transport protocol

Add the separate binary-capable listener/reply channel, frame codec, local
request namespace, cancellation, queue accounting, and lifecycle tests. Reject
hosted, subframe, stale-document, oversized-frame, invalid-sequence, and
post-destruction traffic.

### 5 — enter the bundled client through `NativeSourceTransport`

Implement connection status, JSON fetch, activity, session, and session-watch
subscriptions. Register custom source runtimes from Android source handles and
bypass the web login screen without inventing browser-profile metadata or
exposing native authentication state. Switching hosts obtains another native
handle/runtime rather than invoking web-owned SRP.

This is the first WebView physical-device review checkpoint. On the attached
Pixel, prove concurrent Compose and WebView requests/subscriptions on one native
SRP connection, WebView-only teardown, reconnect restoration, and bounded
bridge metrics against a disposable standalone YA profile.

### 6 — carry large responses and binary blobs efficiently

Add bridge fragmentation/reassembly, ArrayBuffer blob delivery, inbound gzip
format `0x03`, explicit memory/queue limits, and parity for response status,
headers, redirects, setup-required errors, timeout, and abort behavior.

### 7 — stream uploads through the existing binary wire format

Implement `upload_start`, format-`0x02` chunk encryption, progress,
backpressure, cancellation, staged uploads, completion, and cleanup. Verify
1 KiB, 16 KiB, 64 KiB, 256 KiB, 1 MiB, 10 MiB, and 100 MiB cases without
whole-file Kotlin allocation.

### 8 — harden lifecycle and contention

Exercise navigation, rotation, WebView renderer death, Android process death,
network loss, relay reconnect, direct-route selection, queue overflow, a slow
WebView beside active Compose work, and multiple paired profiles. The native
core must remain useful whenever only the WebView consumer fails.

## Validation gates

- TypeScript unit tests cover `SourceTransport` semantics, reassembly,
  cancellation, redirects, error mapping, and upload progress.
- Kotlin unit tests cover frame validation, identifier ownership, flow control,
  encryption formats, lease cleanup, and queue overflow isolation.
- Android instrumentation uses a disposable standalone YA server/profile for
  direct SRP and a relay smoke where route behavior matters.
- Physical-device performance covers 1 KiB through 1 MiB logical responses,
  20–50 Hz events, concurrent Compose/WebView activity, and a 100 MiB upload.
- Existing server request-concurrency, upload-ordering, encrypted framing, and
  stable-client compatibility suites remain warning-free.

The native multi-host prerequisite has its own human checkpoint. The first
WebView checkpoint is after step 5. Steps 6–8 should not be treated as proven
merely because the small-message vertical slice works.

### 9 — retire the duplicate native foreground screens

After native login → web requests/subscriptions → native host switching works,
remove the native summary dashboard and Conversation Activity/screen entrypoints.
Separate host-management state from dashboard subscriptions; retain native SRP,
profile storage, security-client registration, connection managers, and reusable
API/decoder helpers. Keep legacy test evidence in Git history rather than an
unreachable production UI.

## Commit and verification sequence

1. Record the selected product boundary and migration plan (this commit).
2. Land bounded native transport/bridge operations with Kotlin regression tests.
3. Land the TypeScript adapter and native connection bootstrap with request,
   subscription, cancellation, media, upload, and host-isolation tests.
4. Route native login and host selection into the WebView; retire duplicate
   foreground screens only after the replacement is exercised.
5. Verify root lint/format/typecheck/unit suites, Android unit/lint/build and
   connected lifecycle/origin tests, focused browser native-host flows, and real
   sequential typing under concurrent events. Capture the final web surfaces
   through the artifact capture facility. Record unavailable platform/device
   evidence explicitly; no unverified performance or store-release claim.

This is an Android implementation plan using the existing Gradle/Kotlin app.
The same narrow shell boundary is the selected direction for a later iOS app;
creating and publishing the iOS target and store delivery are separate efforts.

## Implementation checkpoint — 2026-09-30

Steps 2–9 are implemented. `MainActivity` reuses the native pairing,
reauthentication and host forms; `WebClientActivity` owns a document lease and
opens `/projects` after native authentication. Switch Host returns to native
management. App Link passwords exist only in transient native UI state. The
Compose dashboard and Conversation entrypoints, state and presentation tests
are deleted; reusable native connection, API and decoding code remains.
Host management acquires no hidden dashboard subscriptions.

The native/client bridge implements the documented exact-origin guard,
request/subscription/upload ownership, binary and bounded base64 frames,
status/header/media parity, gzip reception, abort and per-document cleanup.
A native failure offers Retry/Back. Backgrounding releases the web consumer
except while its platform file chooser is active; returning reloads the route.
Existing web draft storage owns draft recovery. Activity recreation also
restores the native route path, excluding query/fragment credentials.

### Verification evidence

- Root lint, format, typecheck and workspace unit suites pass.
- Bundled Android unit tests, lint and debug/test APK builds pass. Hosted-latest
  unit/lint and both release APK builds pass; no signing/publication claim.
- Adapter tests cover both binary and base64 frames, 1 MiB reassembly/upload,
  redirect/status/header behavior, subscriptions, stale/cold source states,
  cancellation and abort while waiting for credits. Kotlin tests cover framing,
  encryption, upload ownership and pending-subscription teardown without
  disrupting a sibling consumer.
- Browser full-app checks use the real client with a framed native boundary
  fixture at desktop and phone widths. All 68 sequential keys are acknowledged
  within 100 ms while 1 MiB state messages arrive at 20 Hz; observed maxima
  are 32 ms desktop and 25 ms phone. This is a fixture boundary test; it does
  not claim real Android SRP or 50 Hz physical-device acceptance.
- The disposable real-server probe uses native SRP/resume, the bundled app,
  live session updates, ordinary staged attachments, real sequential Android
  key events, background/resume and an independently owned native API lease.
  Native host management stays idle; the sibling lease survives document exit.
- The direct API 35 emulator also passed the 1 KiB, 16 KiB, 64 KiB,
  256 KiB, 1 MiB and 10 MiB attachment cases through the normal editor,
  including resume, native Switch Host and sibling-lease survival.
- A headless API 35 emulator completed a 100 MiB upload proof in 27 s with
  29 keys and a 53 ms maximum acknowledgement. Native outbound queue peak was
  19 KiB; credit p50/p95 was 4.4/45 ms and main-thread frame drain p50/p95
  42/212 microseconds. No overflow was recorded.
- A physical Pixel used the local relay mux for the same 100 MiB proof plus a
  1 MiB encrypted API response. It completed in 16 s with 29 keys and a 72 ms
  maximum acknowledgement. Outbound queue peak was 1.01 MiB; credit p50/p95
  was 2.4/5.7 ms and main-thread drain p50/p95 was 100/238 microseconds.
  No overflow was recorded. Pairing/profile cleanup restored the prior native
  selection and preserved existing profiles.

The final physical rerun also passed resume and native Switch Host, with a
24 ms input maximum after route restoration; the earlier 72 ms maximum
remains the conservative recorded bound. Readiness waits for the replacement document handshake rather
than evaluating JavaScript in a departing renderer, and phone navigation opens
the mobile drawer before choosing Switch Host.

The full browser suite initially recorded 353 passes, 10 skips and three
failures: two captures collided with prior output directories and the emulator
stream case selected the disposable AVD without its device-bridge helper.
Captures now use fresh directories, and the owned emulator is shut down/deleted
before browser verification. The focused rerun passes both native full-app cases
and correctly skips all three emulator-only cases. Final typing maxima were
24.2 ms desktop and 24.9 ms phone. Both captures were inspected through the
artifact capture workflow; the remaining full-suite cases had passed already.

These diagnostic percentiles use the bounded 256-sample ring and are local
observations, not fleet regression baselines. Physical measurement used one
profile circuit with sibling leases; it does not establish fairness between
two simultaneously uploading profiles.

The combined connected run exposed an existing notification test fixture that
revokes an already granted permission inside its own instrumented process;
Android kills the runner. After host-side permission reset and deterministic
login entry, the complete connected runner reports 21 tests passing (including its two config-driven
restart-phase assumptions), covering direct SRP, origin/subframe, notification
permission, rotation/recreation, host management and the new real-web probe.
The fixture issue is tracked in [the notification reset gap](../../gaps/android-notification-test-revocation-kills-runner.md).
Control-plane tests now start directly at `/login` to avoid a redirect dropping
their temporary reply state.

### Remaining release acceptance

- Extend physical coverage to 50 Hz events, simultaneous multi-profile bulk
  traffic, slow network/WebView consumers, representative large transcript
  memory, actual older-WebView binary fallback, physical orientation changes,
  renderer/process death and network/relay fault injection. Existing lifecycle cleanup paths
  and unit ownership checks do not prove every OS failure scenario.
- Complete server push enrollment, notification/tap lifecycle acceptance,
  distribution signing, store delivery and the separately scoped iOS shell.

These are release/further-platform gates; the Android foreground migration is
complete and does not depend on reviving the duplicate native UI.

## October 2 input acceptance diagnosis

[Android CI 36974124012](https://github.com/kzahel/yepanywhere/actions/runs/36974124012)
passed its build and standard instrumentation, then reported 122.1 ms on the
live direct-upload typing probe against the unchanged 100 ms ceiling. The
physical rerun first exposed a fixture mismatch: a personal keyboard setting
capitalized the first hardware character while the fixture expected lowercase.
The probe now disables autocapitalization on its own textarea before focusing;
production composer preferences are unchanged. It retains real sequential key
events, exact final text, one acknowledgement per character and the 100 ms
maximum. Latency failures include all samples, upload size and WebView long
tasks instead of only the maximum, so a further hosted miss is diagnosable.

The fixed fixture passed the physical direct/security and relay-mux acceptance
runs on October 2. Maximum acknowledgement was 22.4 ms for the 1 MiB direct
upload and 23.9 ms for the 100 MiB relay upload, with zero queue overflows.
These are physical observations; they do not establish why the hosted emulator
missed the gate. Latest-source hosted acceptance remains required.

The detailed [hosted rerun 36977714721](https://github.com/kzahel/yepanywhere/actions/runs/36977714721)
again missed the frame gate at 128.4 ms during direct upload. Its 29 samples
were 11.4–128.4 ms and reported no long tasks. This narrows the evidence but
does not prove where the frame waited; the probe now also records key-to-input
timing and the supported observer types. The host launched emulator 37.2.12
with two guest cores and `swiftshader_indirect`. That mode is
[deprecated since 36.4.9](https://developer.android.com/studio/run/emulator-acceleration).
The candidate CI profile uses four guest cores and the supported `software`
backend, logs host CPU/memory/load, and keeps Pixel 7 resolution, real key
injection, both upload modes and every 100 ms input assertion. Hosted
before/after measurements must establish acceptance; this profile change is
not evidence of an application performance fix by itself.

[The four-core software run 36981624479](https://github.com/kzahel/yepanywhere/actions/runs/36981624479)
still missed the direct-upload frame gate at 149.4 ms. Key-to-input samples
remained below 100 ms (maximum 96.7 ms), with two 54/65 ms long tasks; that does
not establish their attribution. The probe previously focused/recreated the
keyboard after starting upload and immediately injected hardware events.
It now establishes the actual native text input connection, loaded fonts and
stable WebView size before starting the same upload and sequential typing.
The frame gate remains 100 ms. Further diagnostics include key timestamps and
long-animation-frame script/layout attribution to distinguish setup from
application work if hosted acceptance still misses the gate.

[The readiness run 36985655022](https://github.com/kzahel/yepanywhere/actions/runs/36985655022)
passed direct/security acceptance, but the 100 MiB relay upload missed the first
key's frame gate at 108.7 ms. Remaining frame samples were at most 65.4 ms;
key-to-input was at most 32.1 ms. Frame attribution identified React's first
input dispatch (75 ms, including 13 ms forced layout), an ordinary-key memo
visibility check that forced 17 ms layout, and reload-stack placement forcing
35 ms layout. These are separate observed frames, not additive costs for the
failing key. Ordinary keys now skip the unrelated memo visibility read, and
empty reload stacks skip geometry/scheduling while retaining placement for
later notices. Deterministic regressions fail on the previous code. Hosted
acceptance of this application work reduction remains required.
