# Initial iOS WebView lacks embedded viewers and Blob download delivery

The consumer shell in `packages/ios/App/NativeBridge.swift` forbids child
frames with entry-page CSP to prevent same-origin children from proxying a
privileged parent bridge. Existing embedded HTML/application previews therefore
cannot run in that document. A separate unprivileged viewer with no source
handle is needed before enabling them. Blob download navigation is currently
cancelled by the same navigation policy and lacks a native download/share
adapter; export actions must gain actual delivery rather than silent failure.

These adapters were deferred from the native connection/build/lifecycle slice,
which proves projects, conversations, typing, uploads and media metadata. They
remain mobile release acceptance work and preclude a full feature-parity claim.
Use isolated WebKit content for previews and a bounded WKDownload/native share
adapter for exports, preserving document ownership and URL policy. Verify the
actual delivered file and viewer's inability to call the native source bridge.

Found 2026-10-01 while implementing the iOS native-login/bundled-web shell.
