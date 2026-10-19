# Android host state, controls and foreground notification

Status: completed 2026-10-18; retained as the requested written plan.
Verification: [physical acceptance and limits](../testing/android-host-controls-2026-10-18.md).
Owning contract: [Android host](../../topics/android-host.md).

The maintainer requested all findings from the native control-state audit,
a small lifecycle foundation, and a useful foreground notification, followed
by end-to-end verification, commit and push. The existing roadmap authorizes
this separate incubation effort. No matching open host-control gap or task
plan was found. Existing lifecycle and workspace physical acceptance are the
baseline, not proof of Doze survival or provider credential renewal.

### 1 — publish authoritative host lifecycle state

Keep Android's foreground service as the sole runtime owner. Publish immutable
snapshots with stopped/starting/ready/stopping/failed state, a launch generation,
error detail and applied storage mappings. Use a private, same-app Android
ContentProvider for cross-process snapshots and change observation: the WebView
runs in `:web`, so Java statics cannot be its authority. Observing state must
never start the runtime. OS permissions and server authentication retain their
existing owners; persisted diagnostics never prove a live host.

Serialize explicit start/stop/restart commands. Repeated requests join current
work; stop cancels startup, and restart waits for verified process-group cleanup
rather than a fixed delay. Fence old callbacks by launch generation. Publish
ready only after authenticated HTTP readiness. Keep operations bounded, and
release workers, observers and connections with their owners.

### 2 — show permission and workspace state beside useful actions

Show all-files allowed/off independently of storage availability and applied
`/sdcard` mapping. Offer Manage after grant. Refresh notification/battery state
on resume, use Android settings when a permission request cannot help, and
avoid silent no-op actions. Render service state into start/open/stop controls.

Render start-with-mappings/restart-to-apply/up-to-date from desired versus
applied mappings; refresh when lifecycle changes finish. Retain separate SAF,
direct preference, current availability and applied state. Show save progress,
restore persisted controls after errors, highlight reselection repair, prevent
duplicate mutations, and expose the 16-folder limit before picking. Preserve
sequential rename typing during asynchronous refreshes.

### 3 — show provider and navigation summaries

Read provider authentication through the existing protected YA provider API
only while the native menu is visible and the host is ready. Show unknown when
stopped/unavailable; do not read credential files or start YA for labels. Show
folder counts and health summaries. Keep tab count/selection, disable new-tab
actions at the 32-tab limit, and retain current recovery behavior.

### 4 — make the foreground notification useful

Render starting/ready/stopping from the same lifecycle snapshot. Tap/Open goes
to YA; Host controls opens setup; Stop opens an interruption confirmation. Use
low importance, no repeated alerts and no prompt/title/path content. Receive
bounded count-only working/attention snapshots from the real YA supervisor,
with initial state and event-driven updates, disconnect cleanup and bounded
reconnect; do not poll or parse session history. Distinguish lost summary
connectivity from a verified idle host. The endpoint is for this coupled
Android runtime, not a new hosted-client dependency.

### 5 — verify recovery, notification actions and real input

Extend existing native lifecycle/storage runners where they expose actual
integration risks: repeated commands, stop during start, restart completion,
server loss, return from settings, count updates and notification actions.
Use the common Machine Control CLI and an explicitly selected dedicated phone;
preserve normal credentials, folders and tabs, and isolate destructive fixtures.
Exercise real sequential typing with 16 folders and concurrent refreshes under
the unchanged 100 ms acknowledgement gate. Capture and inspect native screens
and notification through the repository artifact facility. Run Android Debug/
Release builds and lint, focused host tests, Alpine smoke and required root
lint/format/typecheck/tests. Update the topic, roadmap and evidence with exact
results and limits; review the diff, commit with required model attribution,
and push the current branch.
