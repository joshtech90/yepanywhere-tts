# Android CI can lose its ADB connection during live instrumentation

[Run 37730195569, attempt 1](https://github.com/kzahel/yepanywhere/actions/runs/37730195569/attempts/1)
at `21e149a99` passed the Android build and ordinary instrumentation, then
lost the live runner's ADB connection during the first live case,
`fullWebAppUsesNativeSessionAndReleasesOnlyItsLease`. At 05:34:59 UTC,
`adb` exited 1 with `device offline`, causing `live-transport.ts` to fail.
The emulator process remained present and responded to the cleanup `emu kill`
command. The repeated-refresh case had not started, and the log contains no
`NativeSourceLease object has already been destroyed` stack.

That establishes an interrupted device transport, not its underlying cause
and not successful application acceptance. The uploaded artifact contains
ordinary-test reports; it does not retain live logcat or the emulator crash
database at the point of the lost connection. Capture host emulator/QEMU and
ADB diagnostics on this path, plus any obtainable guest boot/kernel state,
before deciding whether startup readiness, emulator resources or the ADB
service needs repair. A fresh-run pass does not explain this interruption.

The dependency maintenance pass reran only the failed instrumentation job.
[Attempt 2](https://github.com/kzahel/yepanywhere/actions/runs/37730195569/attempts/2)
passed ordinary instrumentation and the complete minified direct/relay live
suite at the same source, retaining the first attempt and unchanged app
assertions. Broader device
transport diagnosis is separate from the native-lease ownership repair; do
not add automatic retries, suppress offline errors or relax refresh/typing
acceptance to hide it. Local downloaded reports and logs are retained under
`tasks/renovate-babysit/` on the diagnosing checkout.

Found 2026-10-08 while verifying the Android repair blocking Renovate merges.
