# Native per-host push delivery

Status: server/broker deployed; Android physical acceptance passes. iOS sandbox
credentials and signed push provisioning are configured; real background APNs
delivery and two-host enrollment pass. Live notification tap routing remains
under validation. Maintainer
direction, 2026-10-02: finish native push using the existing broker, commit
verified slices, and prove real device delivery.

This continues [security-client registration](082-security-client-registration-and-native-push.md)
and follows [notifications](../../topics/notifications.md),
[native push](../../topics/android-fcm-push.md), and the
[security-client child contract](../../topics/security-client-audit.md#native-push-child-contract).
Limited-user login and new-client alert/dashboard work remain separate.

### 1 — enroll and deliver from YA servers

Implemented: child ownership/persistence, generic event delivery, configured-origin
binding, revocation, stale-404 protection and explicit optional ID 111. Focused
ownership/route/policy tests and required root checks pass. Device acceptance
continues with the native app slices below.

Implement the four approved native-push child routes with strict bounded
bodies, authenticated destination lookup, current native continuity ownership,
owner-only persistence and public
secret redaction. Bind each send capability to the configured broker origin.
Connect generic delivery to the existing event policy; bound in-flight work,
disable invalid broker subscriptions and cascade client revocation.
Advertise the exact optional native-push capability and version descriptor only
with mounted support. Missing support disables enrollment without affecting SRP.

### 2 — enroll and present on Android

Implemented. Physical API 37 acceptance uses two disposable SRP-paired hosts and
the public broker: explicit foreground test, real background session events,
authenticated tap, deduplication, unknown/revoked routing, isolated disable and
preserved credentials all pass. A separate invocation proves the app process
was absent before FCM started native presentation. Fixture subscriptions and
profiles are retired; the ordinary protected installation remains registered.

Add native per-profile enable, disable and test operations. Persist the opaque
subscription-to-profile binding before the server can send; compensate partial
enrollment and discard transferred send secrets. Render bounded generic messages,
resolve taps only through protected saved bindings, and resume before opening
the stored host/session. Permission, token rotation, forget and revocation must
remain independent of the WebView.

### 3 — enroll and present on iOS

Implemented with six deterministic push tests: management/subscription bounds,
origin rejection, transfer without local send-secret retention, source rejection
compensation, older-server fallback and two-host routing isolation. All 21 native
tests and both UI tests pass on the simulator; the unsigned Release device
build passes. A signed physical build passes all 20 hardware-selected native
tests (the simulator TLS fixture is excluded) and both UI tests: 37 sequential
keys, zero drops, 41 ms peak and 425 concurrent transcript mutations. The first
hardware UI attempt stopped before typing when the composer tap did not show
the keyboard; a fresh fixture rerun passed without relaxing any check.
Acceptance host catalogs also
use separate push storage so QA lifecycle cleanup cannot retire ordinary
bindings. The private Firebase Apple app, explicit push-enabled App ID and
sandbox/topic-specific APNs key are configured. The signed device app contains
the development APNs entitlement. Two disposable native SRP hosts enroll with
the public broker; a real background session event returns one successful send
and appears with generic copy in iPhone Notification Center. Revoking the second
host's native client leaves zero sends there while the first still sends one.
Native disable retires the broker subscriptions; subsequent events have zero
destinations on both fixtures.
Disabling the unrevoked host preserves its saved SRP credential: native resume
still opens its authenticated project list. Both temporary profiles and broker
subscriptions are retired after testing; the owned fixture processes are stopped.

Device setup exposed first enrollment returning before registration completed,
and the SwiftUI list's Send test invoking the neighboring Disable button. Both
are fixed. Eight focused push tests pass on simulator and signed iPhone,
including delayed first registration and background cancellation. Root checks
pass; real Send test now preserves enrollment. The system notification is
non-hittable in machine-control, and reported taps leave the home screen or
expose a system action instead of opening YA. Live tap routing is not yet proven.
Production credentials, distribution provisioning and publication remain gates.

Use the same optional server contract and broker capabilities with Keychain
bindings. Configure the Firebase iOS app and Apple push provisioning privately.
Complete permission, enrollment, generic presentation, safe host/session taps,
token replacement and disable/forget behavior; preserve foreground suspension.
Credential setup must not block deterministic implementation tests.

### 4 — prove device delivery and record release limits

Use disposable YA fixtures with the existing public broker. Prove explicit test
and actual event delivery in foreground/background, safe taps, two-host isolation,
disable, revocation and preserved credentials. Retire all temporary broker
capabilities. Run focused ownership/failure tests, required root checks, Android
release/lint/instrumentation and iOS native/simulator/device checks. Record exactly
which Apple provisioning and live-delivery gates passed; compilation is not push
acceptance. Repair build blockers needed to execute these tests as separate commits.

Upstream iOS CI is now green at `002ed6e5d`:
[run 37115160898](https://github.com/kzahel/yepanywhere/actions/runs/37115160898).
The earlier 143 ms CI input failure is resolved independently of push delivery;
the unchanged 100 ms typing gate remains required.
