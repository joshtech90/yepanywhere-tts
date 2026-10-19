# Android host state and notification acceptance — 2026-10-18

Scope: the experimental Android host, separate from the published companion.
The [Android host topic](../../topics/android-host.md#native-host-state-and-useful-controls)
owns the behavior contract; [plan 157](../tactical/157-android-host-state-and-notification.md)
records the authorized work.

## Lifecycle and activity ownership

`HostService` remains the sole runtime owner. Main-thread commands and one
serial runtime worker replace scattered booleans and the workspace screen's
fixed restart delay. A private ContentProvider exposes snapshots to native
controls and the separate WebView process without starting a runtime. Each
launch has its own identity; asynchronous completions are fenced against it.
Authenticated HTTP readiness follows process spawn. Unverified cleanup prevents
another launch in the same app process.

The native menu shows actual OS notification/channel and battery authority,
folder health, and protected provider sign-in status. The workspace screen
separates broad permission, storage availability, saved direct preferences and
applied mappings. Rename defers refresh requests until dismissal. The ongoing
notification reports lifecycle and count-only working/attention state, with
Open, Host controls and interruption-confirmed Stop actions.

## Automated checks

- Root lint, formatter verification and typecheck pass. Full workspace tests
  pass: 6,613 server cases (72 skipped), 7,036 client, 962 shared, 139 relay and
  45 push-broker cases. Existing unrelated negative-path diagnostics remain
  documented in the [warning gap](../../gaps/unit-failure-path-log-warnings.md);
  no global suppression was added.
- Normal Android Debug/unsigned Release builds and lint pass. The separately
  identified fixture Debug build and lint also pass without lint warnings.
- The prepared ARM64 Alpine runtime passes authenticated API/frontend/SQLite
  readiness and persistent-project verification across two real starts.
  External desktop observation remains disabled. Both profile tests pass.
- Three count-stream tests cover initial snapshots, slow-consumer coalescing,
  the four-stream bound and subscription cleanup. A real Supervisor with a
  controlled SDK iterator proves working → approval → termination counts.
  That integration caught and fixed a duplicate frame caused by reentrant
  stream pulls during enqueue. The focused suite takes about one second on
  the development machine; it adds no browser or device job to default CI.

## Physical verification

The disposable fixture passed on the explicitly selected,
unlocked Pixel 9/API 37 using actual Android service/PRoot/IPC and mock providers:

- Authenticated ready after spawn, repeated Start, coalesced Restart,
  Start → Stop cancellation, Start received during stopping, and a fresh
  successful launch after verified cleanup.
- The actual Android summary stream reached the foreground notification.
  Open retained the launch generation, Host controls opened setup, Stop opened
  confirmation and Cancel retained the live host. The stopping title and eventual
  notification removal were observed through Android's NotificationManager.
  Notification delivery is asynchronous, so the probe awaits observations.
- Actual all-files Settings grant, a second Manage visit without repeated
  consent, applied `/sdcard` status and Settings revocation. On this Pixel,
  revocation returned a stopped host; explicit Start then converged to current
  mappings. The test follows actual lifecycle state instead of assuming Android
  preserves the process across a permission change.
- Provider summaries resolved to Signed in or Provider unavailable, with no
  permanent Checking label for a provider omitted by the runtime. Cancelled
  Stop left the host ready; confirmed Stop returned stopped controls.
- Sixteen rendered folder registrations and sixteen real sequential hardware
  keys during repeated refresh requests: no lost keys, maximum acknowledgement
  **98 ms** in the final strengthened run (71 ms in the preceding run), under
  the unchanged 100 ms gate. The temporary registry was restored.
  New refresh work is deferred while Rename is open and reads current state on
  dismissal.

The fixture was uninstalled in cleanup. Deployment of the normal APK and prepared
runtime with the normal host stopped preserved all **587** offline
private-state/preference/registry witnesses, with matching hashes before and
after deployment.
Raw logs, hashes, device selectors and captures remain under ignored `.local/`.

The installed normal host then passed all eight existing recovery scenarios:
cold Open, launcher/Open document preservation, native Home/Open preservation,
tab selection/history/close, identified launch-Node loss followed by Retry,
confirmed Stop/Open, force-stop/reopen with a retained marker, and missing
launch-script repair/Retry. Native tab preferences and the exact launch script
were restored, and temporary markers/forwards were removed.

The regression exposed a readiness race during tab replacement: duplicate
page-completion callbacks replaced a probe without changing the navigation
generation. Cancelling the older HTTP probe could return unavailable and fail
the newer healthy page. A separate verification sequence now fences those
replaced callbacks. The successful final run retains the real tab/recovery
assertions. The UI driver recognizes title-plus-path labels and waits for the
Stop confirmation window to disappear before resolving Open. The disposable
native probe separately establishes actual Start-during-stopping convergence.

The final normal app was reopened and left ready for the maintainer. Its
protected provider API and native menu both report Claude and Codex installed
and signed in. An unauthenticated summary request returned **401**; an
authenticated stream returned only `working` and `attention`, both zero.
After Home, the actual foreground notification still displayed ready/counts
and all three actions. Final native menu, workspace-permission and cropped
owned-notification captures were inspected individually and presented through
the repository artifact facility. These native surfaces have no desktop layout.

## Limits

These checks do not establish Doze/overnight survival, reboot recovery, provider
credential renewal, or successful resumption of an interrupted real provider
turn. The count stream carries no prompts, session titles, ids or paths and
does not poll transcripts. Older staged runtimes without the endpoint show
activity unavailable. No hosted-client compatibility contract changes.
