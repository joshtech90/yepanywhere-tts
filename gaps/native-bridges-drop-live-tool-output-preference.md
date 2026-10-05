# Native bridges drop the live command output preference

The web client sends `wantsLiveToolOutput` with each session subscription,
and the server withholds live tool output from subscribers that set it
`false`. The Android and iOS bridges forward subscribe fields one by one
through the shared Rust core: `wantsLiveDeltas` is carried
(`YaWebTransportSession.kt`, `YaServerConnectionManager.kt`), the new field
is not. A native-hosted web client with Live Command Output off still hides
the output, by dropping it locally, but still receives it, so the bandwidth
saving the setting promises does not apply there.

Not fixed with the setting because the Kotlin, Swift and Rust layers could
not be built or exercised on the development host. The fix mirrors the
`wantsLiveDeltas` plumbing through the native subscribe request into the
server subscribe message.

Found 2026-10-04 while adding the Live Command Output setting.
