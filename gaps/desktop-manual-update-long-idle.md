# Manual desktop update check reportedly stays silent after hours

The maintainer saw **Check for Updates** show no result on a MacBook even
after the desktop app had been running for many hours. The installed version
and preceding hide/minimize/sleep history are not yet known.

The 2026-09-28 investigation reproduced and fixed a separate case: manual
requests were discarded while a startup or periodic check was busy. Native
tray handling also now shows the updater window before delivering its event,
removing reliance on a hidden renderer waking itself. Neither establishes
the cause of the maintainer's hours-later observation.

Signed Stable 0.2.2 reported up to date after six real minutes with no visible
windows, after application hiding, after minimization, and after closing and
reopening the updater. See the [QA log](../docs/testing/desktop-release-qa-log.md)
and `packages/desktop/scripts/updater-macos-idle-smoke.py` for the reproduction
boundary. Six minutes exercises the documented suspension threshold but does
not establish behavior after hours or a MacBook sleep/wake cycle.

Next evidence: exact installed desktop version and a reproduction after the
same sleep/wake or long-running history. Inspect whether the packaged `main`
renderer remains alive, receives the tray event, and finishes native IPC.
Keep manual no-update and failure feedback explicit; automatic checks alone
are intentionally silent in those cases.

Found 2026-09-28 while investigating the reported silent desktop update check.
