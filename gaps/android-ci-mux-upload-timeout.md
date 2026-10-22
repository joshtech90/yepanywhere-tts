# Hosted Android mux upload intermittently misses completion

[Nightly run 39400754964](https://github.com/kzahel/yepanywhere/actions/runs/39400754964)
failed the native WebView mux proof: the 100 MiB upload did not appear complete
in `.attachment-list` within the existing 120-second deadline. Diagnostics
showed roughly 95 MB sent with the transport still connected. This does not
establish whether the upload stalled, the runner was slow, or completion was
lost. The preceding day's ADB-offline failure is a separate defect.

The unchanged upload assertion passed in
[release run 39469337588](https://github.com/kzahel/yepanywhere/actions/runs/39469337588),
which completed the direct and mux suites and published the tested bundle to
internal testers. That pass establishes intermittence, not a root-cause fix.

Retain native upload/frame diagnostics and correlate transfer progress with
completion delivery before changing the upload implementation or its deadline.
No assertion, retry or timeout was changed during release preparation. The
original instrumentation evidence is retained under
`tasks/release-2026-10-20/android-failure/`; a native reproduction is needed
to distinguish transport progress from the final attachment UI update.

Found 2026-10-20 while checking CI before coordinated releases.
