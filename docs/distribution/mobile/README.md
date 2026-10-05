# Mobile store preparation

Initial store assets reuse the existing green Y identity. The English copy in
[`listing.en-US.txt`](listing.en-US.txt) is shared across stores; keep claims
consistent with the shipped build. Private console identifiers, developer
account details, credentials and signing configuration belong in the private
dotfiles runbooks, not here.

## Reusable assets

| Asset | Source / dimensions |
| --- | --- |
| Apple app icon | [`packages/ios/App/Assets.xcassets/AppIcon.appiconset/icon.png`](../../../packages/ios/App/Assets.xcassets/AppIcon.appiconset/icon.png), 1024 × 1024 opaque PNG, bundled in the app |
| Google Play icon | [`packages/android/artwork/play-store-icon.png`](../../../packages/android/artwork/play-store-icon.png), 512 × 512 PNG |
| Google Play feature graphic | [`feature-graphic.png`](feature-graphic.png), 1024 × 500 opaque PNG; editable [`SVG`](feature-graphic.svg) |

Regenerate the feature graphic with librsvg and ImageMagick:

```sh
rsvg-convert docs/distribution/mobile/feature-graphic.svg \
  -o docs/distribution/mobile/feature-graphic.png
magick docs/distribution/mobile/feature-graphic.png -alpha off \
  PNG24:docs/distribution/mobile/feature-graphic.png
```

The graphic is branding, not a simulated app screenshot. Capture actual native
apps against owned sample hosts for store screenshots; do not resize unrelated
browser screenshots or expose real projects, credentials or notification tokens.
Use the console's current accepted device sizes, including iPad for the
universal iOS app. Real screenshot capture remains a later listing task.
See [Google's preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151)
and [Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/).

## Initial internal distribution

As of October 3, 2026, both store draft records exist. Apple has saved initial
metadata and an internal TestFlight group. Google Play has saved the English
listing text, app icon and feature graphic as a draft, plus a dedicated internal
tester list. The first local upload artifacts are built from committed source:
Android 0.1.0 / version code 1000 is active and available to the selected
internal testers; its opt-in page was verified with the maintainer account.
On October 4, the first installed Android release exposed a UI-initiated TLS
login failure: the OS verifier attempted certificate revocation network work
on Main before SRP started. Android 0.1.1 / version code 1001 moves native
connection setup to IO without relaxing certificate verification. Its signed
bundle from committed source is now published to the existing internal track;
Google Play shows **Available to internal testers** with 1001 as the latest
release. Physical acceptance covers Main-initiated public TLS relay login,
the bundled WebView, and a separate isolated package built with production
Release shrinking rules. The earlier background/plaintext probes missed this.
Android 0.1.2 / version code 1002 is also available to internal testers. It
fixes stale sign-in state after interrupted resume/host switching and duplicate
WebView system-bar insets. The Play signing certificate is now associated with
website passwords; Google Digital Asset Links verifies the association. These
fixes passed isolated-host physical-device regressions and browser checks.
Acceptance on the tester's updated Play installation remains open.
iOS 0.1.0 / build 1 uploaded through Xcode's TestFlight Internal Only flow and
now shows **Ready to Test** after saving the encryption questionnaire with
France excluded. iOS tester enrollment remains open.
Google Play category and contact settings remain open; Developer Tools is saved
on Apple. Console links and account-specific inventory live in private dotfiles.

A full public listing is not the first internal-testing prerequisite.
[Google permits internal testing before completing app setup](https://support.google.com/googleplay/android-developer/answer/9845334).
[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
requires an uploaded, processed build and testers; external testing introduces
additional review requirements. A saved draft or processed upload alone does
not make a build installable; the testing track and tester enrollment must also
be active.

### Local upload path

The maintainer selected platform-managed distribution signing on October 3.
Initial uploads were local; the CI delivery path below is now enabled and
verified. Keep upload preparation separate from public rollout and use a
clean, committed source snapshot.

For Android, build the bundled Release AAB with the existing native/core and
frontend preparation. Sign the bundle with a dedicated upload key, then let
Google generate and retain the app signing key when configuring Play App
Signing. The upload key authenticates submissions; its certificate is not the
certificate Google uses for installed apps. Do not register the upload-key
fingerprint as the production password-manager association.

```sh
node packages/mobile-core/scripts/run.mjs android
pnpm --filter @yep-anywhere/android prepare-frontend
cd packages/android
./gradlew :app:bundleBundledRelease
jarsigner -keystore "$YA_UPLOAD_KEYSTORE" \
  -storepass:env YA_UPLOAD_STORE_PASSWORD \
  -keypass:env YA_UPLOAD_KEY_PASSWORD \
  -signedjar app/build/outputs/bundle/bundledRelease/yepanywhere-upload.aab \
  app/build/outputs/bundle/bundledRelease/app-bundled-release.aab upload
jarsigner -verify app/build/outputs/bundle/bundledRelease/yepanywhere-upload.aab
```

Provide the SDK/JDK environment and upload passwords privately; never place
passwords in command-line arguments, tracked Gradle properties or build logs.
Verify the AAB's signer against the upload certificate and retain its source
commit, version code and SHA-256 alongside the artifact. Upload the signed AAB
to the internal track; subsequent uploads need increasing version codes.
See [Google's signing guide](https://developer.android.com/studio/publish/app-signing).

For iOS, prepare the generated project and device Rust library, then archive
locally using the existing Apple Development identity and automatic
provisioning. Set the team through ignored `Config/Signing.xcconfig` or the
command environment. The archive is an input to distribution; the existing
unsigned CI device build is not an uploadable IPA.

```sh
node packages/ios/scripts/run.mjs prepare
node packages/mobile-core/scripts/run.mjs build
cd packages/ios
xcodebuild -project YepAnywhere.xcodeproj -scheme YepAnywhere \
  -configuration Release -destination generic/platform=iOS \
  -archivePath build/YepAnywhere.xcarchive \
  -onlyUsePackageVersionsFromResolvedFile -allowProvisioningUpdates \
  "DEVELOPMENT_TEAM=$YA_APPLE_TEAM" archive
open build/YepAnywhere.xcarchive
```

Use Xcode Organizer's **Distribute App → TestFlight Internal Only** for the first
internal upload, or **App Store Connect** for a build intended for later review.
Use automatic distribution signing and Apple's cloud-managed certificate. An
App Store Connect API key authenticates uploads; it is not an app signing key.
Do not copy JSTorrent's manual certificate/profile or its AltStore notarization
pipeline for this path. See [Apple's cloud signing guidance](https://developer.apple.com/help/account/certificates/cloud-managed-certificates).

Prepare signed production-channel artifacts with matching application IDs,
increasing build numbers, bundled Firebase configuration and reviewed export
compliance. Android CI can sign and publish after the one-time setup below. iOS CI
still verifies without uploading signed mobile artifacts. Production APNs configuration is separate from the proven sandbox
key; Debug delivery cannot prove TestFlight delivery.

Before broader distribution, finish real screenshots, privacy/data-safety
disclosures (including optional native Firebase/broker push), age/content
ratings, review access to an owned sample server, pricing and availability.
Do not mark encryption absent merely because transport uses standard crypto:
the shared Rust core uses SRP and libsodium outside OS-only TLS. Resolve the
applicable declaration/documentation before distributing a build.

### Android CI internal delivery

The existing [Android workflow](../../../.github/workflows/android-app-ci.yml)
now produces a bundled Release AAB and has a publication job depending on both
build/lint/unit checks and WebView instrumentation. Publication requires both
`ANDROID_PLAY_PUBLISH_ENABLED=true` and a manual main dispatch with
`publish_internal=true` (default: false). The dedicated, keyless Google identity,
main/workflow/environment-restricted federation, app-only testing grant and
GitHub configuration are provisioned, the Android Publisher API is enabled,
and manually requested publishing is available. Pushes and nightly runs verify
without publishing.

[Hosted CI run 37202914083](https://github.com/kzahel/yepanywhere/actions/runs/37202914083)
passed build verification and WebView instrumentation, authenticated through
GitHub OIDC, and published `0.1.2-ci.464.1` / code `56401` from `fca9705a3`.
Google Play confirms **Available to internal testers**. The retained receipt
reports `published` on `internal`; its SHA-256 matches the signed upload, and
all 895 original bundle entries match the tested candidate. Only the signing
metadata was added. The [main CI suite](https://github.com/kzahel/yepanywhere/actions/runs/37202914085)
also passed, including both browser shards and iPad WebKit.

The Android tabs and warm-resume update was published by
[run 37226132033](https://github.com/kzahel/yepanywhere/actions/runs/37226132033)
as `0.1.2-ci.473.1` / code `57301`, from `72fbb38fc`. Both Android verification
gates and publication passed. Play confirms **Available to internal testers**;
the `published` internal-track receipt names that source commit and its SHA-256
matches the signed upload. CI repairs covered an emulator Pixel Launcher ANR
and WebView link names exposed as content descriptions. The separate general
browser suite retains the
[mockup caption-icon assertion defect](../../../gaps/mockup-export-caption-icon-count.md).

The main-only GitHub `android-internal` environment holds the existing upload
key as `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_STORE_PASSWORD` and
`ANDROID_UPLOAD_KEY_PASSWORD`. The signing step checks its public certificate
fingerprint before signing. The repository secret `ANDROID_GOOGLE_SERVICES_JSON`
restores the same Firebase build configuration before the verified main build;
PR builds remain credential-free. No app-signing key is exported from Google.

To release a new internal test version, open **Actions → Android App CI → Run
workflow**, select **main**, and enable **Publish to Play internal testing after
verification**. The equivalent command is:

```sh
gh workflow run android-app-ci.yml --ref main -f publish_internal=true
```

This runs the build and tests, then publishes their exact AAB. A plain manual
run only verifies. Ordinary verification still runs on its existing push and
nightly cadence; newer runs on the same ref cancel obsolete verification work.
Explicit releases run separately and are not cancelled by subsequent pushes.
No release tag or trusted-publishing permission change is required.

One-time setup and acceptance procedure:

1. Create a dedicated Google service account with no general project roles.
   Enable the Android Publisher and IAM Credentials APIs in its project.
2. Configure GitHub OIDC Workload Identity Federation, restricting admission to
   the immutable repository/owner IDs, `refs/heads/main`, the Android workflow
   path on main, and the `android-internal` environment subject. Grant only
   `roles/iam.workloadIdentityUser` on this service account to that identity.
   Do not create a long-lived service-account JSON key.
3. In Play Users and permissions, give that account access only to
   `com.yepanywhere.mobile`: view app information and release to testing tracks.
   Do not grant production releases, account administration, financial data,
   subscriptions, or tester-list management.
4. Set GitHub environment variables `ANDROID_PLAY_WIF_PROVIDER` and
   `ANDROID_PLAY_SERVICE_ACCOUNT` to the provisioned identities. Set the repository
   variable `ANDROID_PLAY_PUBLISH_ENABLED=true` only after these are ready.
5. Dispatch Android App CI on main with `publish_internal=true` and verify
   a `published` receipt plus
   **Available to internal testers** in Play. An upload or draft alone is not
   successful delivery. A draft-app/API restriction must be resolved explicitly;
   the script never silently downgrades to a draft or chooses another track.

See [Google's Play API setup](https://developers.google.com/android-publisher/getting_started)
and [Google's GitHub authentication action](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account).
Account IDs and concrete provisioning commands belong in private dotfiles.
The [packaging contract](../../../topics/trusted-client-packaging.md#android-internal-ci-delivery)
owns versioning, stale-run protection and audience boundaries.

### Apple encryption declaration

The October 3 questionnaire uses the standard-encryption-outside-Apple-OS option:
the shared core implements SRP with SHA-512 and libsodium secretbox
(XSalsa20-Poly1305), in addition to TLS. These are published cryptographic
algorithms; the app must not be declared OS-only or encryption-free.
[Apple's overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)
distinguishes proprietary/unpublished cryptography from published algorithms.

The maintainer deferred France on October 3. App Store availability is saved
for 174 countries or regions, with France **Not Available** and automatic
availability in future countries disabled. The build questionnaire retains the
standard-encryption option and answers **No** to France distribution; Apple
required no attachment and the build now shows **Ready to Test**. No Info.plist
encryption setting was changed.

**Deferred to-do — enable France:** clarify with ANSSI whether this app requires
a declaration or qualifies for an exemption, complete any required filing, and
obtain the documentation Apple accepts before enabling France and revisiting
the questionnaire. Apple's
[documentation matrix](https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption)
explains the French documentation gate. The unsigned technical draft is retained
in private dotfiles; it is not an approval form and has not been filed or
uploaded. Private filing details and console inventory belong in that runbook.
Keep France excluded when configuring broader Android distribution as well.

Keep initial releases internal. App Store review submission and public Play
rollout are separate actions from preparing draft records and internal tracks.
