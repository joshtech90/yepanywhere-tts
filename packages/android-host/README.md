# Yep Anywhere Android host (experimental)

A separate incubating Android application that hosts YA locally, like the
desktop application. The phone owns its agents, projects and sessions. Remote
access is optional future Android lifecycle work. This is separate from the
published remote companion at `../android` and the capture/control sidecar at
`../android-device-server`.

The owning [product/runtime contract](../../topics/android-host.md) distinguishes
implemented scaffold behavior, original feasibility evidence and remaining work.

## Layout

```text
app/        Java status/setup controls, foreground service and local WebView
runtime/    Shared startup/profile contract, Alpine package/artifact pins
tools/      Payload preparation, real Linux smoke, Android provisioning, AAR lease
test/       Portable profile/persistence-boundary checks (included in pnpm test)
.local/     Ignored downloads, generated bundle/locks, keys, state and evidence
```

There is one YA server/frontend build from this checkout, one Alpine payload,
and one runtime launcher. The Android service starts it through PRoot. Docker
runs that same filesystem natively as a non-root ARM64 Linux process; it does
not emulate Android. Ordinary UI/server development still uses `pnpm dev` and
the existing tests without Alpine or an emulator.

## Durable local workspace experiment

The standalone [workspace spike](workspace-spike/README.md) tests a user-picked
local shared folder mapped directly to `/workspace`, with optional explicit
all-files access. It uses a different disposable application ID and leaves this
host's runtime state and sign-ins untouched. Enable its Gradle module only with
`-PworkspaceSpike`; ordinary host builds do not include it. This is physical
storage qualification, not production onboarding or a general SAF mount.

Optional all-files access now maps primary shared storage directly to `/sdcard`
on host start, without picking a folder. `/sdcard/Download` and
`/sdcard/Documents` use the actual shared files. Enable the permission and use
**Apply mappings / restart host**; the folder screen reports availability.
Mounted writable removable cards also map to `/storage/<volume-id>`. The folder
screen lists their paths/status; insertion or media changes require a controlled
restart. See the guide for removal limits and physical evidence.

The host also supports [multiple named workspace folders](docs/workspaces.md):
open **Workspace folders**, add each folder through the picker, and optionally
enable broad all-files permission plus per-folder direct access. Apply mappings
with the explicit restart control, then select `/workspaces/<name>` as a normal
project path. Without broad permission, use installed `ya saf` document commands.
The guide records limits, recovery and isolated physical acceptance.

## Linux user and home

YA and providers run as `user` (UID/GID 1000), with `/home/user` and the guest
hostname `ya-phone`. Standard Alpine sudo permits passwordless guest
administration: use `sudo apk add ...` or `sudo -i`. PRoot identities share the
Android app's authority; guest sudo grants no Android root or user isolation.

Existing app-private state is retained in place. `/home/host` aliases
`/home/user`, preserving existing paths and provider profiles. Packages and
custom account changes remain in the replaceable runtime. See the
[user/admin contract](../../topics/android-host.md#guest-user-and-administration).

## Prepare and test without Android

Prerequisites: this checkout's installed pnpm dependencies, Python 3.11+, curl,
npm, and an available Docker engine supporting Linux ARM64. Preparing executes
the existing YA build and installs only public runtime dependencies with npm
lifecycle scripts disabled. It starts no provider inference or sign-in.

```sh
python3 packages/android-host/tools/host.py prepare
python3 packages/android-host/tools/host.py smoke
node --test packages/android-host/test/profile.test.mjs
```

`prepare --cache "$DOWNLOAD_CACHE"` can reuse previously downloaded files,
still checking every hash. `--skip-build` uses an existing `dist/npm-package`
from this checkout; rebuild it after server/client changes. No nested YA source
checkout or separately maintained server dependency list is used. Direct npm
versions come from the committed pnpm server importer, not potentially stale
host node_modules. The generated npm integrity lock is retained with the local
payload for repeat builds; it is regenerated when direct versions change.
`runtime-info.json` records source revision/dirty state, workspace lock hash,
npm lock hash and exported payload hash. Fully release-reproducible packaging
and lock publication remain future work.

The smoke creates an isolated mock-mode home, starts the actual server, checks
frontend/SQLite, requires HTTP 401 without the local credential, verifies
external process inventory is disabled, registers a project, restarts the
container, and verifies that registration survived. It removes its container
and temporary home on exit. Logs and evidence remain in `.local/`.

## Build and provision the experimental Android app

Prerequisites: JDK 17+ and Android SDK platform 36/build tools, with
`ANDROID_HOME` set. The Gradle entry point reuses the existing Android Gradle
wrapper. `prepare` supplies the hash-verified PRoot libraries and license assets.

```sh
packages/android-host/gradlew :app:assembleDebug :app:assembleRelease :app:lint
python3 packages/android-host/tools/host.py install --serial "$ANDROID_TEST_SERIAL"
python3 packages/android-host/tools/host.py stage --serial "$ANDROID_TEST_SERIAL"
python3 packages/android-host/tools/host.py check-user --serial "$ANDROID_TEST_SERIAL"
```

The package id is `com.yepanywhere.host.experimental`; its launcher label is
**YA Host (Experimental)**. Choose **Open Yep Anywhere**; it starts the local
host if needed and waits for readiness. **Start local host** is also available
as an explicit service control. Closing the UI does not stop the service. **Stop local host**
stops the process tree while retaining app-private state. The service does not
restart itself unattended, arm ADB, or enroll push/remote access. Open and the
provider setup shortcuts can restart it after process loss or an APK update.
Errors expose **Retry** and **Host controls**. Reopening a healthy existing
page preserves its document; returning from the provider browser does not
unconditionally reload a sign-in form.

For a Codex session in the existing YA UI, choose **Full Access**: YA passes its
selected permission mode to app-server and can override the CLI profile's
sandbox default. The ordinary sandboxed modes still fail under PRoot. This does
not change Claude's permission defaults or silently override a chosen YA mode.

`stage` uses debug `run-as` only to provision the selected experimental app. It
stops that app and replaces `files/runtime`, retaining one previous root. It
never replaces `files/state`: native rollouts, YA SQLite, provider logins and
the local access credential live there. Runtime execution is owned by the app's
foreground service, not `run-as` or test instrumentation. An unsigned Release
APK is built for checks; store distribution is not configured.

The native controls show current lifecycle, provider sign-in, folder health,
notification/channel permission and battery exemption. Permission actions remain
explicit; already allowed settings can be managed. Workspace controls show
all-files permission separately from availability and applied mappings, and
update after restart completes. Stop requires interruption confirmation.
The foreground notification shows lifecycle and count-only session activity;
Open returns to YA, Host controls opens setup, and Stop host asks for confirmation.
Older staged payloads without the summary endpoint show activity unavailable.

The native controls are an incubation surface, not final onboarding. Notification
permission and the battery exemption are offered only through explicit actions.
Battery settings do not enable remote access or guarantee process survival.

The host selects the `battery` relay keepalive profile: a long scheduling gap
gets a fresh five-second liveness probe before reconnecting. Normal pings remain
30 seconds apart. For comparison, set `"relayKeepaliveProfile": "default"` in
private `development.json` and restart. General server/desktop defaults are
unchanged. The [relay liveness contract](../../topics/android-host.md#battery-aware-relay-liveness)
records the roughly ten-second interactivity target and Android wake limits.

Use **Set up Codex** or **Set up Claude** from the native controls to open the
shared focused sign-in page, then choose **Sign in**. These pages also work in
desktop/remote YA without navigating the long advanced provider settings list.
The actual CLI's output and errors stay visible. Provider links open the Android
browser; return to YA for Claude's authorization-code field. Codex uses device
code approval. Complete account authorization yourself in the provider browser.

The Android service mirrors the active network's DNS servers into Alpine while
it runs, including network changes. It does not force a public DNS service.
Encrypted DNS enforcement and unusual VPN DNS configurations need independent
validation; musl does not use Android's resolver automatically.

## Optional AAR development mode

This uses the existing computer router's **inference** listener through a scoped
USB reverse. Its private control socket remains on the computer. No global
phone configuration, provider OAuth store or host ADB private key is copied.
Direct and AAR provider homes are separate and persistent; switching mode does
not overwrite direct-provider sign-in.

```sh
python3 packages/android-host/tools/aar.py start \
  --serial "$ANDROID_TEST_SERIAL" --aar-checkout "$AAR_CHECKOUT" \
  --claude-account "$AAR_CLAUDE_ACCOUNT" --codex-account "$AAR_CODEX_ACCOUNT"
# Start the host from its launcher. No agent is launched merely by preparing AAR.

python3 packages/android-host/tools/aar.py stop --serial "$ANDROID_TEST_SERIAL"
```

Only a derived, revocable gateway grant is written to private `development.json`.
Its use in the provider API-key environment headers is a gateway launch/header
convention, not an upstream paid API credential; AAR supplies subscription OAuth.
The helper refuses existing development config/tunnels, stores a private recovery
lease, and revokes the grant before phone cleanup, verifying 401 for both
providers. A failed cleanup retains the lease for retry. It never enables TCP
adbd or modifies other device mappings. Use explicit enrolled subscription
accounts; leave real selectors and account ids outside Git. Stopping returns
future launches to direct mode. Phone-local direct subscription sign-in has
been completed and confirmed by the user for both Claude and Codex on the
Pixel 9; it does not require AAR or imported workstation credentials.

## Native navigation

The web screen has a persistent **Home · Tabs · +** toolbar. Home returns to
setup/status controls and Open returns to the selected tab. The tab picker
selects or closes tabs; + opens Projects. Long-press a local link to open it in
another tab. Provider setup shortcuts reuse matching sign-in tabs.

Like the companion app, only one WebView is mounted. Switching tabs restores
navigation and reloads the page; YA owns draft persistence. Paths and selection
survive process death, while query/fragment state and in-memory history do not.
No credentials are stored in tab preferences. See the
[navigation contract](../../topics/android-host.md#implemented-scaffold-contracts).

## Current boundaries

- ARM64 only, manually provisioned runtime. No first-launch downloader or updates.
- Runtime/foreground-service scaffold, not a background/Doze acceptance result.
- Existing full YA frontend is reused; no separate conversation UI.
- Focused subscription login works for both providers, confirmed by the user on
  the Pixel 9. Credential persistence across restart, refresh/sign-out, real
  session resume after process death, remote wake/relay lifecycle, same-phone
  ADB setup and agent MCP registration remain validation/integration work.
  ADB is in the payload but is not auto-started.
- External tracking/inventory is disabled. Native history discovery stays scoped
  to this app's own provider profiles; no external desktop histories are mounted.
- Downloaded Claude/native libraries retain their upstream terms and notices.
  Runtime preparation for development is not an approval to redistribute them.

See the [initial evidence record](../../docs/testing/android-host-scaffold-2026-10-17.md)
and [lifecycle investigation](../../docs/testing/android-host-lifecycle-2026-10-18.md)
for exactly which checks have run.

## Headless debug lifecycle

Use an already authorized ADB device and current debug APK installed for user 0.
These commands also work with the display off or keyguard showing, after the first user unlock
following boot. They preserve app data and never open an activity:

```sh
python3 packages/android-host/tools/host.py control --serial "$ANDROID_TEST_SERIAL" status
python3 packages/android-host/tools/host.py control --serial "$ANDROID_TEST_SERIAL" start
python3 packages/android-host/tools/host.py control --serial "$ANDROID_TEST_SERIAL" restart
python3 packages/android-host/tools/host.py control --serial "$ANDROID_TEST_SERIAL" stop
# Select the independent Lab explicitly:
python3 packages/android-host/tools/host.py control --serial "$ANDROID_TEST_SERIAL" --package com.yepanywhere.host.lab start
```

Start/restart wait up to 45 seconds for native authenticated readiness; stop
waits for native shutdown. `--timeout` changes this bounded wait (at most 120
seconds). Failure is reported without foregrounding UI. For direct diagnostics,
the shell intents are `am start-foreground-service --user 0 -n
PACKAGE/com.yepanywhere.host.HostService -a host.start` (or `host.restart`), and
`am startservice --user 0 -n PACKAGE/com.yepanywhere.host.HostService -a host.stop`.
Read status with `content call --user 0 --uri content://PACKAGE.host-state --method snapshot`.
Use the ADB shell identity, not `run-as`: Android may reject background service
starts and external provider access under the app UID. Both debug entry points
require Android's `DUMP` permission; release components remain non-exported.
Use this path for lifecycle automation before considering any screen interaction.

## Physical lifecycle regression

With the current debug APK installed, an existing provisioned runtime, a stopped
host and an unlocked dedicated test phone using the English UI, run:

```sh
node packages/android-host/tools/lifecycle.mjs --serial "$ANDROID_TEST_SERIAL"
```

The opt-in runner uses the MC doctor/launcher/capture CLI, actual native taps
and the debug WebView's CDP endpoint. It checks opening a stopped host, document
identity across system Home/launcher/Open and native Home/Open, tab switching,
history retention, closing a background tab, server termination during navigation,
Retry, rapid Stop/Open, force-stop/reopen and missing-runtime repair. Each opened
WebView also checks that native system-bar/cutout spacing is not applied again
through CSS safe areas. It briefly
renames only `launch.mjs` while the app is stopped and restores the exact file;
a private recovery record names that rename until restored. It preserves
app-private sessions/configuration, isolates/restores the native tab preferences,
and removes its own marker, temporary UI dump and ADB forwards in cleanup. The selected host is left stopped. It does
not test real provider inference, reboot, credential refresh or Doze. Evidence
is private under `.local/lifecycle-*`; do not commit device captures/selectors.

## Native controls and notification regression

Prepare the current runtime, stop the normal host (the fixture uses the same
loopback port), and build the separately identified fixture. An existing fixture
is refused rather than overwritten. With an explicit unlocked test phone:

```sh
packages/android-host/gradlew -PworkspaceFixture :app:assembleDebug :app:lint
cp packages/android-host/app/build/outputs/apk/debug/app-debug.apk packages/android-host/.local/controls-fixture.apk
python3 packages/android-host/tools/controls_live.py --serial "$ANDROID_TEST_SERIAL"
```

The runner provisions only its disposable fixture with mock providers, tests
actual service/PRoot/IPC readiness, command coalescing and cancellation,
notification actions/count delivery, Android Settings all-files grant/revocation,
mapping restart convergence, and real sequential Rename typing with 16 rendered
folders. It preserves the normal host's data and permissions and uninstalls the
fixture in cleanup. Raw captures, private receipts and results stay in `.local/`;
present selected reviewed captures through the repository artifact facility.
Rebuild without `-PworkspaceFixture` before installing the normal host APK.

## Build a disposable Lab APK on the phone

The [on-phone build guide](docs/phone-build.md) covers the verified ARM64 Alpine
path without Gradle: pinned SDK JARs, Android-native AAPT2 through same-phone
ADB, javac/D8, signing and the separate purple **YA Host Lab** application.
It builds the native shell from this checkout and does not rebuild the server
payload. The Lab uses its own application ID, private data and port 13410;
its installer cannot target the build controller's application ID. Public
signing identity inventory and bounded stop/restart verification are included.
