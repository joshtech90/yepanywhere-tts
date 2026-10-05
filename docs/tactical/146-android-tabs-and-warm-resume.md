# Android tabs and warm resume

Topic: mobile-server-pairing

Status: implementation complete, 2026-10-04. Maintainer approved the native
top bar, internal-only tabs, warm foreground document and end-to-end delivery.

## Existing evidence and boundaries

[The offline investigation](../testing/android-offline-recovery-investigation.md)
identified document teardown on background and launcher replacement at Projects.
[The native WebView plan](083-android-bundled-web-native-transport.md) established
exact-origin, profile-bound document capabilities and independent native leases.
This work changes their lifetime, not authentication or the server protocol.
The task/gap search found no separate tab implementation to extend.

## Implementation

### 1 — Own navigation in one activity

The launcher activity owns both host management and the selected WebView.
Launcher resume must not navigate, show login, or replace the document. Preserve
the selected document through ordinary backgrounding and window resizing;
process/renderer death restores navigation, not the JavaScript heap.

### 2 — Separate document and transport lifetimes

Keep the local bridge and WebView alive when backgrounded, release only their
native transport lease, then reacquire and notify existing web recovery on
foreground. Pending operations fail cleanly. Hidden tabs do not retain native
subscriptions, sockets, retry work or unbounded queues. Sibling leases survive.

### 3 — Add native tabs and direct switching

A 48dp native bar below system/cutout insets shows the host, tab count and plus
button. Tabs open a directly accessible list with host, page, selected state
and close controls. Plus chooses a saved host for a new tab; ordinary host
selection reuses an existing tab. Multiple tabs may bind to the same profile.
Picker presentation preserves the current document. Only the selected tab
needs to be warm; inactive tabs keep bounded navigation state and restore on
demand. Persist safe routes and tab identity without credentials.

### 4 — Route internal new-tab links and external links

Long-press internal links offers opening a background tab. User-initiated
new-window navigation opens an internal tab only for the bundled YA origin.
External HTTPS links go to the system browser, without a native bridge.
Unsupported schemes remain blocked. Cold tabs never acquire a lease.

### 5 — Verify the actual Android lifecycle and record contracts

Extend native instrumentation to assert document identity, draft preservation,
launcher/background resume, tab/host isolation, picker lifetime and navigation
restoration. Exercise the shipped WebView against a disposable relay server on
the attached Pixel, including sequential typing and radio interruption. Run
Android unit/build/lint and workspace checks, inspect native UI captures, update
the mobile behavior contract and roadmap, then commit the scoped change.

## Verification and limits

The durable contract is in
[mobile server pairing](../../topics/mobile-server-pairing.md#android-native-tabs-and-launcher-lifetime).
The bundled launcher uses one Activity. Only the selected tab stays warm;
inactive tabs retain up to 64 navigation entries in memory, with a safe route
fallback. Process/renderer loss also restores a safe route, not the JS heap.
No new server capability, authentication credential or native source principal
was introduced. Hosted-latest keeps its existing independent web login.

Physical Pixel 7a / Android API 37 acceptance passed against disposable direct,
local two-host mux and public TLS relay fixtures. Checks include:

- Same JavaScript object/time origin, composer DOM node/value and transcript
  scroll position after backgrounding and launcher re-entry, including with
  both radios disabled. Recovery delivers a newly appended live message.
- The native tab picker preserves the current document. Plus, same-host tabs,
  two-host selection, close, internal long-press/background opening and internal
  new-window opening work. External new-window navigation emits Android VIEW
  and leaves the document and tab count unchanged.
- Rotation retains document identity and applies safe areas once. Activity
  recreation restores the selected profile and route. Host management releases
  its source demand while keeping the document, including during held resume.
- Real sequential typing during the 100 MiB mux upload retained every key;
  maximum acknowledgement was 28.4 ms, under the 100 ms device requirement.
- Native JVM tests and Android lint pass. Workspace lint, format, typecheck and
  the full unit suite pass (6,712 client and 6,357 server tests; other workspaces
  also pass). Fourteen focused native-source client tests include suspended
  requests and frame credits deferred across 120 seconds of simulated hiding.

The console scan remains within its existing 110-site budget, tracked by
[console debt](../../gaps/runtime-cutover-tooling-warnings.md). Intentional
negative-path server warnings remain tracked by
[unit warning debt](../../gaps/unit-failure-path-log-warnings.md); changed
native-source tests and native lint have no warnings. Node 24 avoids the known
Node 26 tsx-loader deprecation. Host validation ran on macOS with a physical
Android device; other desktop build hosts and iOS were not exercised.

The adjacent probe startup race is repaired separately: readiness now waits
for relay registration rather than only an open HTTP port. Existing host-switch
instrumentation now targets the owned, fully visible host card, and waits for
transport separately from the already-visible warm page. Final UI captures use
the repository artifact facility after native dialogs/rotation settle.
