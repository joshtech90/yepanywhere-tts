# Android self-revocation returns 503 over the public relay

An exploratory run of `YaSecurityClientE2eInstrumentedTest` through the public
TLS relay authenticated, registered, checked in and recovered an unknown client,
then returned 503 where the self-revocation DELETE expected 200. The same test's
existing direct fixture remains its established acceptance boundary.

The observed assertion is in
`packages/android/app/src/androidTest/java/com/yepanywhere/mobile/security/YaSecurityClientE2eInstrumentedTest.kt`,
after `securityClients.ensure` and the DELETE of its own registered client.
Check whether server-side revocation closes the mux circuit before its DELETE
response can reach Rust/Kotlin. That ordering is a hypothesis, not established
by this one run. Authentication and the bundled WebView independently succeeded
through the same public relay.

Kept separate from the main-thread TLS login fix: this changes the revocation
response/lifecycle boundary and needs its own owned relay reproduction and
revocation lifecycle verification. Do not broaden the existing test to public relay and then
silently weaken its expected successful response.

Found 2026-10-04 while reproducing Google Play native login failure.
