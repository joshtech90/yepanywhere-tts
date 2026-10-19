# Opportunistic emulator WebRTC check fails with a generic app-test AVD

`packages/client/e2e/emulator-stream.spec.ts:149` opts in when an emulator and
the device-bridge executable are present. In the broad 421-case browser run,
it selected the separately owned native-app test emulator, displayed device
state `failed`, and hit the outer 15-second test deadline while its inner
connection assertion allowed 30 seconds. The bridge executable existed.

The actual bridge failure cause is unresolved; the error context does not
establish a stale binary, missing setup or a production regression. Retain
bridge/startup diagnostics and reproduce this narrow case against its intended
device fixture before changing behavior. A longer timeout alone is not a fix.
This is WebRTC remote device control, distinct from Android's SRP transport and
artifact video-file playback. It was not repaired as part of that work. No
assertion, skip or timeout was relaxed, and no bridge process was left running.

Found 2026-10-17 while qualifying Android secure transport and artifact delivery.
