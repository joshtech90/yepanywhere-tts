# Android Credential Sharing

> Associate the packaged Android app with `yepanywhere.com` so compatible
> password managers can offer existing Remote Access credentials in the app.

Topic: android-credential-sharing

## Status

The two-way Digital Asset Links declarations include the Google Play app-signing
certificate for `com.yepanywhere.mobile` as of 2026-10-04, alongside the retained
maintainer development certificate. The Play fingerprint comes from the app's
**App signing → Digital Asset Links JSON** panel, not the upload certificate.
The existing Play internal-test build already references this website statement,
so publishing the updated statement does not require another APK release.

The October 4 report came from a **Play internal-test installation**. Previously
the website listed only the development signer, which cannot associate a
Google-signed installation. This is distinct from the earlier sideloaded-build
observation below. A physical Play-installed credential suggestion remains the
acceptance check; association validation alone does not prove that Google
Password Manager presents a matching dataset.

## Known Gap: Credential Suggestion Acceptance

The earlier sideloaded debug APK offered only the generic Passwords action,
requiring a manual website search even with valid development Digital Asset
Links. Native Compose fields already declare standard Autofill content types.

Google's current [setup guide](https://developers.google.com/identity/credential-sharing/set-up)
requires publishing the app through Play and matching the installed signing
certificate. It does not establish that a public production rollout is required
instead of internal testing. Verify the existing internal track before asserting
any further distribution restriction.

## Observable Contract

- The website serves
  `https://yepanywhere.com/.well-known/assetlinks.json` directly over HTTPS with
  a JSON content type and no redirect.
- The statement list declares password credential sharing between
  `https://yepanywhere.com` and the Android package
  `com.yepanywhere.mobile`.
- The Android app includes that statement list through its application
  metadata.
- The web relay and direct login forms expose the standard `username` and
  `current-password` autocomplete hints.
- Native Compose onboarding exposes `ContentType.Username` and
  `ContentType.Password` Autofill semantics. Native reauthentication exposes
  `ContentType.Password`. These hints request the system password-manager UI;
  they do not give YA access to stored credentials or assert that any dataset
  matches `yepanywhere.com`.
- App Link authorization remains bounded by the Android manifest. The app's
  current verified-link intent filter handles only exact HTTPS
  `yepanywhere.com/open` routes.
- Native code rejects unexpected schemes, hosts, ports, paths, fragments,
  malformed encoding, and links without nonempty `u` and `p` parameters. A
  rejected link opens the ordinary configured client without link-supplied
  state.
- An accepted link becomes a fragment on the fixed, build-configured WebView
  URL. Link text is never interpolated into executable JavaScript and cannot
  choose a different privileged WebView origin.
- A missing, unreachable, malformed, or certificate-mismatched statement fails
  closed: Android does not treat the app and website as associated.
- Credential suggestions remain under the installed password manager's control.
  YA does not read, export, or broker stored password-manager data.

## Debug-Build Scope

The initial website statement names the SHA-256 certificate fingerprint of the
maintainer debug APK used for live-device development. It therefore matches
only APKs signed by that same debug key. A source build signed by a different
developer's debug key is not associated.

The certificate fingerprint is public identity material; its private signing
key is not published. Nevertheless, a debug signing key is not a production
trust anchor. The Play app-signing certificate is now included. The development fingerprint
is deliberately retained for the existing dedicated-device workflow; it does
not establish association for other developers' debug keys. The upload key is
not included because it does not sign Play-installed APKs.

The development association validates the Digital Asset Links chain and supports
password managers that honor it. It does not establish credential suggestion
acceptance for either sideloaded or Play-distributed builds.

## Verification

For each website release:

1. Confirm the URL returns HTTP 200, `Content-Type: application/json`, and no
   redirect.
   The deployment artifact must copy hidden static directories; a wildcard
   such as `site/dist/*` omits `.well-known`. Artifact uploaders that exclude
   hidden files by default must also be explicitly opted into them.
2. Check both credential-sharing statements through the Digital Asset Links
   API or validator.
3. Verify the APK's signing certificate matches the published fingerprint.
4. Reinstall the APK, request Android App Links re-verification, and inspect the
   package's domain state.
5. Let the user test the configured password manager on the relay login form;
   automated tooling must not inspect or disclose saved credentials.

For native Compose onboarding, also focus the username and password fields and
confirm that the configured Autofill provider offers its inline action. The
user, not automated tooling, verifies whether a specific website credential is
available through the provider's manual picker.

## Debug Live Verification

Completed on 2026-07-31 with the maintainer-signed debug APK and an attached
Pixel 9 running Android 17:

1. Published the two-way statements through `site-v1.8.3` and confirmed the
   production URL returns HTTP 200, a JSON content type, no redirect, and the
   exact checked-in body.
2. Downloaded the Pages artifact and confirmed it contains both
   `.well-known` association files. Earlier `site-v1.8.1` and `site-v1.8.2`
   runs exposed and then closed separate hidden-directory copy and upload
   omissions.
3. Reinstalled the matching debug APK without clearing app data. Android domain
   verification moved from the previously cached verifier error to `verified`.
4. Confirmed the WebView exposes `relayUsername` as an editable field and
   `srpPassword` as a password field.
5. Confirmed through WebView debugging that the bundled Tauri page runs at
   `http://tauri.localhost`, not at the saved credential's
   `https://yepanywhere.com` origin.
6. Focused the relay login fields and inspected only system Autofill metadata.
   Google Autofill recorded a successful response with one dataset for
   `com.yepanywhere.mobile`; inline suggestions were enabled. The user's
   visible test established that this dataset was the generic Passwords search
   action, not a matched `yepanywhere.com` credential. The system count alone
   was not sufficient evidence of a credential match.

This proves the published website/app statements, package certificate match,
Android App Link verification, and valid Autofill field exposure. The
sideloaded Google Password Manager result is negative for seamless credential
sharing: the user must search manually. Do not claim automatic
`yepanywhere.com` suggestions until a Play-installed build passes the visible
device test.

The first-class Android-shell replacement was checked on a Pixel 7a running
Android 17 / API 37 on 2026-08-02. The replacement APK retained the same debug
certificate and package identity, Android reported `yepanywhere.com` verified,
and enabling that device user's previously disabled link selection made a cold
HTTPS `/open` intent launch `MainActivity` and its Android-owned WebView. The
replacement intent filter no longer admits HTTP or path-prefix lookalikes.

Native Compose username/password Autofill semantics were added and installed
on the Pixel 9 on 2026-08-03. Build-time verification proves that the Material
fields expose the supported Compose content types. The visible Google Password
Manager result remains a user-owned physical-device check so saved credential
labels or values never enter automated output.

## Play Distribution Follow-Up

- Publish and validate the website statement against the Google-managed app
  signing certificate; keep the upload certificate out of the association.
- Re-test automatic suggestions in both native pairing and reauthentication
  using the existing Play internal track and record the device/provider result.
- Revisit the retained development signer before general public distribution.
