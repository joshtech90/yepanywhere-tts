# Moto X4 Android host feasibility — 2026-10-18

The attached Moto X4 successfully ran the shared Alpine/PRoot runtime, YA
server/frontend, and both real provider CLIs using a temporary account-scoped
Agent Auth Router grant over USB. This qualifies a local compatibility
prototype, not Android 9 support in the standard host APK.

This extends the [scaffold evidence](android-host-scaffold-2026-10-17.md) and
[lifecycle investigation](android-host-lifecycle-2026-10-18.md). The owning
[Android host contract](../../topics/android-host.md) retains its existing
incubation and authentication boundaries.

## Support decision after the experiment

On 2026-10-18, the maintainer accepted Android 9/API 28 ARM64 support for now,
with reassessment if maintaining it adds friction. The
[host support contract](../../topics/android-host.md#older-android-support)
owns the decision and review triggers. This decision does not change what the
prototype established: integrating its compatibility changes into the standard
build remains follow-up work.

## Device and prototype boundary

- Android 9/API 28, ARM64, Linux 4.4.153, approximately 3 GB RAM and initially
  4.9 GB available app storage. The installed WebView provider was version 138.
- The standard host declares API 30 minimum and cannot install unchanged.
  A local Gradle override and ignored source copies lowered the test floor to
  API 28, used the older window-inset accessors, and guarded all-files access.
  Shared-storage mappings were unavailable; all provider work stayed private.
- The existing verified runtime was reused. Independent SHA-256 checks matched
  the extracted Node, Codex, Claude and runtime launcher bytes to the payload.
  The older Android tar extracted the files but returned failure for ownership
  restoration. No other tar error was observed; `--no-same-owner` was separately
  verified as an available extraction option before completing staging.
- The prototype reused the experimental host application identity on this
  previously uninstalled device. No companion, other phone, radio setting,
  battery exemption or ADB listener was changed.
- Only a revocable derived inference grant reached the phone. Upstream account
  credentials and router control remained on the Mac. This did not test direct
  phone subscription sign-in or operation independent of the Mac's router.

## Observed end-to-end results

| Boundary | Result |
| --- | --- |
| Guest runtime | Node executed the existing user/admin check: UID 1000, `/home/user`, `ya-phone`, guest sudo UID 0 and the old-home alias passed. |
| Service and web UI | Native Start/Open launched the real foreground-service-owned server and actual on-phone WebView. Anonymous project API access returned 401. |
| Codex inference and tools | A real full-access session ran shell, Python and Git version checks, wrote a random witness plus the independently checked result `500500`, and returned its success marker. |
| Claude inference and tools | A real session used Bash/Python to read that result, verify it and write a second matching witness file. ADB independently read back the bytes. |
| Browser submission and updates | A follow-up submitted through the phone WebView executed a Python progress loop and completed with its success marker. |
| Sequential typing | All 168 characters and every intermediate prefix survived during that turn, with 466 observed DOM mutations. Worst keydown-to-input acknowledgement was 24.1 ms; worst keydown-to-next-frame callback was 69 ms. These are one-run observations, not a benchmark. |
| Full host restart | Force-stop removed the old Node processes and closed the API. Native Start/Open restored authenticated readiness in approximately 18 seconds and preserved the witness bytes. |
| Actual provider resume | Both existing canonical sessions resumed with new provider processes and executed new shell writes containing the original witness. This was more than retained transcript display. |
| Short screen-off work | With Android reporting Asleep and the display OFF, Codex executed a delayed Python write. Independent bytes and the still-asleep state were verified after approximately 20 seconds, then the display was restored. |

## Limits and cleanup

The API-28 lint attempt failed on newer API/resource references and included
both original sources and local replacements. This is not a lint-clean Android
9 distribution. Production compatibility still needs explicit guards and
fallbacks for storage controls, API-29 theme resources and inset handling, plus
an ordinary supported build configuration. The standard API-30 Debug/Release
builds and lint passed afterward; the existing host profile tests passed 2/2.
No tracked runtime or application source was changed for this experiment.

Screen-off execution used a charging USB-connected phone and diagnostic reads.
It establishes neither Doze/overnight endurance nor observer-free background
operation, battery cost, interrupted-turn recovery, reboot recovery, Release
execution, direct provider authentication, shared/removable storage or remote
access. The phone's clock was visibly stale and was left unchanged; inference
used the Mac router, so this does not qualify direct HTTPS/OAuth behavior.

Raw transcripts, device selectors, account selectors, credentials, APK, local
source copies, test scripts and actual-device captures remain under ignored
`packages/android-host/.local/x4/`. The reviewed final capture was delivered
through the repository artifact capture facility. Temporary inference authority
was revoked with HTTP 401 verified for both providers. Development configuration,
owned USB reverse/diagnostic forwards and the temporary UI dump were removed.
The experimental test APK and saved app-private sessions were retained, with
the host stopped. Ordinary build outputs were restored to the standard build.
