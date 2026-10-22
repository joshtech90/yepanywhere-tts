# Native Android emulator acceptance permits input above 100 ms

`YaNativeWebAppInstrumentedTest.fullWebAppUsesNativeSessionAndReleasesOnlyItsLease`
in `packages/android/app/src/androidTest/java/com/yepanywhere/mobile/web/`
uses a 2,000 ms input acknowledgement ceiling on emulators and 100 ms on
physical devices. That emulator exception does not enforce the repository's
100 ms per-keystroke requirement.

The initial local API 35 mux/100 MiB reproduction on rustls 0.23.46 recorded
a 165.2 ms maximum and continued past the input assertion, then reproduced the
separate host-profile handoff race. A subsequent run with the handoff wait
repair recorded 48.5 ms. That repair executes after typing and cannot explain
the input difference. Neither the old allowance nor a passing later sample
establishes reliable 100 ms acknowledgement on this testbed.

Keep the timing samples and attribute the slow frame before changing input,
rendering or test setup. The allowance needs reconciliation with the shared
contract; raising it or treating the current emulator pass as strict input
acceptance would hide the gap. This remains separate from the native profile
wait repair and TLS dependency update. Local logs and the initial failure
capture are retained under `tasks/rustls-native-review/` on the diagnosing
checkout.

Found 2026-10-21 while reproducing native acceptance for the rustls update.
