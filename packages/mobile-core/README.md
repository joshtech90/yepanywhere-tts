# YA native connection core

This is the credential-bearing core for the iOS and Android apps. It is separate from
`mobile-core-proof`, which remains a differential experiment. Shipping
arithmetic uses pinned RustCrypto SRP 0.7.0-rc.3 and crypto-bigint, not SRP 0.6
or num-bigint. The accepted limits and ownership contract are in
[mobile pairing](../../topics/mobile-server-pairing.md#ios-and-shared-rust-direction).

The existing server needs no migration: owner SRP uses YA's existing
2048-bit/SHA-512 password hash, padded scrambling input and minimal integer
proofs. M2 and authenticated server-info precede credential persistence.
Resume binds both nonces, session id and the previously authenticated minimum
protocol version. OS randomness supplies private scalars and secretbox nonces.
Owned secret buffers and big integers use zeroize; minimal wire encodings do
not imply that the entire profile is constant-time or independently audited.

Tokio owns one bounded authenticated session actor per native profile.
NativeRuntime serializes profile acquisition; NativeSourceLease gives each
consumer separate subscriptions, uploads, event queues and cancellation.
A document releases only its own demand; the final owner closes the source. Concurrent eligible
relay sources share a physical mux socket with independently bounded circuits;
retiring or overflowing one circuit preserves healthy peers. It handles encrypted
requests, subscriptions, uploads, resume and three bounded reconnect attempts.
The final circuit closes its socket and cancels its work. No web login or key
material is part of the source bridge. Direct routes and eligible relay mux
routes use the same authentication; unavailable mux setup falls back to the
exact configured legacy relay endpoint. Explicit custom URLs remain authoritative.
TLS uses rustls with the platform verifier and OS certificate trust. Android
initializes the verifier with the application context and enforces its network
security policy in the native route adapter.

The native app uses the stored entry points with a CredentialPersistence owner.
A verified full-login credential is durable before capabilities or continuity
registration. Resume invalidates the older stored credential before connecting
and persists the authenticated high-water before capabilities. A storage failure
or cancellation can require full login; it cannot silently reuse an older pin.
Reconnect follows the same rule. Ordered direct/relay candidates retain the
preferred route, then direct-first fallback; every candidate must authenticate
the saved identity. Successful routes become preferred for reconnect. The memory-only entry points remain available
for diagnostics, whose callers own any persistence.

Subscription queue pressure is attributed to queued owners; the offending owner
is removed and receives a bounded error. Progress/state events coalesce, and
server-rejected subscriptions are not restored. Cancelling requests releases
pending slots without waiting for the request deadline. Generated Swift bindings
apply a version-checked cancellation adapter to UniFFI 0.32.2's exposed
rust_future_cancel/free API, since its Swift template lacks cancellation support.
The lifetime gate serializes cancellation and free; blackholed simulator login
and resume tests verify actual socket release.

Run from the repository root with Node 24 LTS and the pinned Rust toolchain:

```sh
node packages/mobile-core/scripts/run.mjs rust
node packages/mobile-core/scripts/live.mjs
pnpm exec tsx --conditions source packages/mobile-core/scripts/live-relay.ts
node packages/ios/scripts/run.mjs test
node packages/ios/scripts/run.mjs build
```

The live runner owns a disposable unchanged YA server and public fixture
credentials. It kills that process when finished. Its tests are explicitly
ignored in ordinary Cargo runs; the runner enables them. No developer YA
configuration, projects or actual credentials are used. The sodium source is
pinned by SHA-256 and its upstream signature in `vendor/libsodium`; Cargo
builds never download a mutable latest/stable libsodium archive. Native generated
files and archives are ignored. iOS tests use a disposable simulator and ad-hoc
signing for Keychain;
the device build is unsigned and is not a publication or physical-device claim.

Android builds require JDK 17, Android SDK 36, NDK 28.2.13676358 and
cargo-ndk 4.1.2. Gradle generates the Kotlin bindings and four API-24 native
ABIs (arm64-v8a, armeabi-v7a, x86, x86_64). Android generation enables UniFFI's
Android cleanup path so the existing minimum API remains 24. Sodium uses NDK
archive tools and the shared-library link rejects unresolved symbols. The
upstream platform-verifier AAR is pinned by SHA-256. Release APK inspection
checks every packaged native ELF load segment for 16 KiB alignment.

```sh
pnpm --filter @yep-anywhere/android prepare-frontend
cd packages/android
./gradlew test lint assembleBundledRelease assembleHostedLatestRelease
cd ../..
pnpm --filter @yep-anywhere/android inspect:apks
pnpm --filter @yep-anywhere/android test:live
```

The Android live runner requires one authorized device/emulator (or an explicit
ANDROID_SERIAL). It installs an R8-minified debug probe and its test APK without
clearing application data. Only that debug build opts into cleartext fixtures;
Release network policy is unchanged. It owns two disposable servers, a relay
and exact adb reverse mappings, and removes those mappings/processes on exit.
It checks security continuity/revocation, existing credential resume, route
fallback, independent mux hosts, the bundled WebView and sequential typing
during a 100 MiB upload. The Kotlin crypto/backend remains differential test
code only; production credentials and session work use Rust.

The initial native apps support owner login. Limited-user sign-in, OPAQUE,
store signing/publication and server-native push enrollment remain separate
work; the existing server requires no authentication or credential migration.
