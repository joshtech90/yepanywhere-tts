# Experimental Android host

Read ../../AGENTS.md and ../../topics/android-host.md first. This is a separate
Android host application, not the published remote companion under ../android.
Keep its application id distinct and preserve the companion and the original
external spike during tests.

The product is local YA: real provider CLIs and the existing server/UI run in
app-private Alpine/PRoot. Normal use should eventually need only the phone and
internet; AAR is optional development infrastructure. Do not replace provider
CLIs with a custom harness. The native provider setup shortcuts and focused
shared YA sign-in pages are the onboarding baseline: the user completed both
Claude and Codex subscription sign-ins on the Pixel 9. Keep refresh, sign-out
and restart-persistence validation distinct from that successful initial login.

Use one payload and launch/profile contract for Android and the Linux harness.
Build YA from this checkout, not a nested source snapshot. Do not add desktop
external-session observation: YEP_EXTERNAL_SESSIONS=false, private provider
homes only, no workstation home mounts. Reading this host's native rollouts for
history/resume is still required. Add feature flags only for concrete needs.

Runtime binaries, npm generated locks, captures, credentials, device selectors,
leases and logs belong under ignored .local/. Pin and verify downloads, retain
upstream licenses, and never copy upstream OAuth stores or host ADB keys.
PRoot is not a sandbox; Codex full-access here is explicitly authorized and
retains Android app confinement, not Codex workspace isolation.

Use machine-control Android doctor/install/launch and explicit serials. Never
kill the shared workstation ADB server. AAR helpers must preserve other tunnels
and grants, revoke temporary clients, and retain recovery leases on failure.
Phone tests must not alter unrelated apps, radio state or debugging listeners.

Linux checks prove Linux behavior only. Do not claim Android background, Doze,
resume, provider sign-in, reboot recovery, or remote wake from a container test.
Match docs and evidence to what ran. Run the existing root checks plus the
focused host tests, Alpine smoke and Android build/lint when affected.

For on-phone APK builds, signing inventory or disposable Lab testing, read
`docs/phone-build.md`. Use the separate `com.yepanywhere.host.lab` package and
its own port/state; never install, stop or restage the controller hosting the
active agent. Keep per-device inventory and all keys/captures in private local
storage, with only reusable tooling and generic evidence in Git.
