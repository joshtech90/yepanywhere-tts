# Android CI can hit dependency rate limits after emulator startup

Internal-release run `37704886933` (511, attempt 1) on `c3d828c98` passed
build/lint/package inspection and the minified probe build before emulator
startup. The connected-test command then failed before executing app tests:
Maven Central returned HTTP 429 for instrumentation-host dependencies including
`kotlinx-coroutines-core-jvm:1.7.3`, `protobuf-java-util:3.24.4`,
`opencensus-proto:0.2.0` and `atomicfu:0.22.0`. These are pulled through AGP's
UTP host plugins / `com.google.testing.platform:launcher:0.0.9-alpha03`.
Gradle reported 62 of 65 tasks up-to-date; APK shrinking was not the failure.
Publication was skipped. The visible failure log is retained with the campaign.

`assembleBundledDebugAndroidTest` does not resolve every host-side dependency
needed by `connectedBundledDebugAndroidTest`. Consider a bounded dependency
preparation step before booting, using the pinned AGP's actual configurations,
with explicit transient-download handling. Do not change repositories, skip
verification or relax app assertions to hide an external 429. A subsequent
successful run alone does not eliminate this dependency/setup weakness.

The same-source release was rerun with **all jobs**, preserving failed-attempt
evidence. Rerunning only failed jobs is inappropriate for this publishing
workflow: its version and artifact names include the attempt number, so the
candidate must be rebuilt and verified together. Attempt 2 cleared dependency
setup and executed app tests; its separate whole-job timeout does not erase
the first attempt's external download failure. Replacement run `37712235822`
(513) passes both Android gates and publishes successfully; the external
dependency-preparation weakness remains follow-up work.

Found 2026-10-08 during final internal-release verification.
