# Shizuku

Reviewed 2026-10-18 through public source and documentation only. No device
startup, permission change, installation or integration was attempted.
Source pins: Shizuku [b844bc491f17](https://github.com/RikkaApps/Shizuku/tree/b844bc491f1790c72328e1a8e5b2349f8978f0ea), API [a27f6e4151ba](https://github.com/RikkaApps/Shizuku-API/tree/a27f6e4151ba7b39965ca47edb2bf0aeed7102e5).
The API pin matches the parent repository's `api` gitlink. See the
[reference manifest](android-host-references.yaml).

## Role and relevance

Shizuku is a user-enabled Android privilege broker, not an agent runtime or a
terminal distribution. It starts a server with ADB shell or root identity and
lets approved applications communicate through Binder. This is relevant to
YA's optional phone-control setup and Machine Control's authority/readiness
boundary, not an automatic dependency choice.

The [project overview](https://github.com/RikkaApps/Shizuku/blob/b844bc491f1790c72328e1a8e5b2349f8978f0ea/README.md) explains the Binder
proxy model and contrasts it with repeatedly launching command-line utilities.
[ShizukuService.java](https://github.com/RikkaApps/Shizuku/blob/b844bc491f1790c72328e1a8e5b2349f8978f0ea/server/src/main/java/rikka/shizuku/server/ShizukuService.java)
handles client attachment, caller permission checks and permission-confirmation
results. The
[manager authorization UI](https://github.com/RikkaApps/Shizuku/blob/b844bc491f1790c72328e1a8e5b2349f8978f0ea/manager/src/main/java/moe/shizuku/manager/authorization/AuthorizationManager.kt)
is a separate user-facing control over which applications may use the service.

## Startup, permissions and lifecycle

The [official setup guide](https://shizuku.rikka.app/guide/setup/) documents
three paths: root, wireless debugging on Android 11+, and computer-assisted
ADB startup. Wireless debugging can bootstrap on the phone without a computer;
non-root service startup needs repeating after reboot. Network/OEM restrictions
and shell permission differences remain relevant.

ADB shell identity is not root. The API docs identify shell UID 2000 and root
UID 0 and warn that capabilities vary by platform. A running broker, an approved
client and sufficient authority for a particular operation are separate facts.
Do not translate "Shizuku connected" into "all Android operations available."

The [client API](https://github.com/RikkaApps/Shizuku-API/blob/a27f6e4151ba7b39965ca47edb2bf0aeed7102e5/api/src/main/java/rikka/shizuku/Shizuku.java)
provides Binder-received/dead listeners, permission requests and user-service
binding. Its [provider](https://github.com/RikkaApps/Shizuku-API/blob/a27f6e4151ba7b39965ca47edb2bf0aeed7102e5/provider/src/main/java/rikka/shizuku/ShizukuProvider.java)
distributes the Binder to app processes. The
[rish shell bridge](https://github.com/RikkaApps/Shizuku-API/blob/a27f6e4151ba7b39965ca47edb2bf0aeed7102e5/rish/README.md)
is especially relevant to CLI-facing research: commands execute under the
server identity, and app-private Termux paths/environment variables may not be
accessible to an ADB-owned process. It is not a transparent expansion of the
Alpine process's own UID or filesystem access.

## Distribution and limits of the precedent

The [official download page](https://shizuku.rikka.app/download/) links Google
Play and GitHub releases. Its developer-options/ADB setup is evidence that this
kind of explicit advanced setup can coexist with Play distribution. It is not
blanket approval for every client operation, autonomous workflow or use of
non-public Android interfaces. The source overview itself calls out hidden-API
and Android-version compatibility issues.

Shizuku does not require AccessibilityService for its Binder broker model.
That separates its mechanism from Buddy's screen-reader-style automation,
but does not exempt a consuming app from policy or authority checks. See the
[YA distribution assessment](../../topics/android-host.md#distribution-and-optional-phone-automation).

## Implications for YA

YA's basic coding host should work without Shizuku, ADB or device-automation
permissions. The preferred advanced direction remains explicit developer-mode
setup with the existing ADB/MC route, potentially bootstrapped from a computer.
Shizuku's phone-only wireless startup is an alternative to research, not an
implemented fallback or a requirement to integrate its API.

A future integration would need to report broker lifecycle, per-client grants,
actual shell/root identity and per-operation availability independently. Keep
reusable device operations in Machine Control; YA owns sessions and onboarding.
No broker adoption, device verification or assistant-role spike is selected by
this document.

## License and reuse

Shizuku declares Apache-2.0 and explicit branding/asset restrictions in its
README. Shizuku-API declares MIT; read each exact file and dependency before
reuse. The separate licenses are one reason to pin both repositories. No
upstream code, icons, package identity or permission names were imported.
