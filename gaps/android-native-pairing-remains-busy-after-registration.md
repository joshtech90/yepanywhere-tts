# Android pairing can remain busy after successful registration

On the owned Android 15/API 35 ARM64 emulator (WebView 124.0.6367.219), a fresh
bundled Debug app completes SRP login and persists its device registration on
the real YA server through the public encrypted relay. The native host screen
then remains busy, with Open full app disabled, for the 45-second observation
window. No WebView is created. A force-stop and normal launcher restart resumes
the saved profile and reaches the bundled viewer.

The same stall reproduces with the unmodified main server at `9b44f3c67`.
The feature branch changes no Android or mobile-core source, so this is not a
managed artifact preview regression. Registration is independently observed
through the real server's security-client inventory before the stall. Root
cause is not established. Inspect `YaPairingCoordinator.pair()` and its
`transport.closeAndAwait()` cleanup, and the native transport's cancellation
and wrapper-retirement path; do not bypass enrollment or remove cleanup to
make the UI proceed.

Reproduction: build the bundled Debug APK with the current web assets, then
run `artifact-host/acceptance.mjs --public-relay --native-fallback` on an
explicitly selected disposable `ANDROID_SERIAL` emulator. The optional
`YA_ARTIFACT_TEST_SERVER_ROOT` selects a baseline server checkout, without
modifying it. `--resume-after-pair` is an explicit test-setup workaround and
must not be reported as successful fresh-pairing acceptance.

Why not fixed in place: this investigation qualifies artifact delivery. Native
transport lifecycle and pairing are a separate boundary, and removing cleanup
or changing shared recovery while testing a viewer would hide the defect.
A future fix needs a real fresh UI pairing test plus native lifecycle coverage.

Found 2026-10-16 while testing the managed artifact viewer in Android emulator.

Physical-device follow-up on 2026-10-16: a fresh isolated bundled Debug app on
Android 17/API 37 (WebView 154) successfully pairs through the native UI and
automatically reaches its WebView, with no cold-resume workaround. The current
evidence therefore scopes this stall to the tested Android 15 emulator/setup;
it is not a demonstrated universal native pairing failure. Root cause of the
reproduced emulator stall remains unestablished.
