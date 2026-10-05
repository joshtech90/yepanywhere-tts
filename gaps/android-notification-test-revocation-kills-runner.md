# Android notification permission reset kills the instrumentation runner

`WebClientActivityTest.resetNotificationPermission()` calls
`UiAutomation.revokeRuntimePermission` inside the instrumented application.
On the API 35 emulator, revoking an already granted POST_NOTIFICATIONS
permission kills that application process and its test runner. A combined
connected suite terminates at `recentUserActionCanResolveNotificationPermission`
after otherwise passing native connection, host-management and WebView
origin/rotation cases. System log evidence is `ActivityManager: Killing ...:
permissions revoked`, followed by `Process crashed`; this is not a WebView
transport failure.

This was adjacent to the WebView foreground migration, not a change to the
notification implementation. Reset permission from the host before launching
each permission-dependent test in its own instrumentation process, or establish
a host-driven grant/revoke fixture with explicit process-restart semantics.
Do not increase a timeout around an instrumentation process Android kills.

Found 2026-09-30 while validating the native-login/full-WebView migration.
