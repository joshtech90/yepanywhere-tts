# Experimental mobile crypto/build proof

This isolated crate implements step 1 of the
[iOS/shared-core plan](../../docs/tactical/138-ios-native-core-proof.md).
Neither installed app depends on it. Its sole exported API verifies public
test fixtures and returns check names, never keys or login credentials.
The maintainer accepted the shared Rust direction and pinned SRP 0.7 backend.
The production core and later implementation steps remain to be built and
verified; this public-fixture API stays separate from production authentication.

## Reproduce

Use a maintained repository-supported Node version, pnpm, the pinned Rust
1.97.0 toolchain, and platform compilers. Run from this directory:

```sh
node scripts/run.mjs rust
node scripts/run.mjs bindings
node scripts/run.mjs ios
node scripts/run.mjs android
```

`all` runs all phases. `rust` regenerates/checks the TypeScript oracles, checks
Rust formatting, runs the Rust vectors and rejection cases, and runs Clippy
with warnings denied. `bindings` executes the generated Kotlin API on the
host JVM and, on macOS, the Swift API on the host. Kotlin uses the repository's
existing Android Gradle wrapper and requires a JDK. It does not launch Android.

`ios` requires macOS, Xcode, XcodeGen, the Rust device/simulator targets, an
available iOS runtime and the iPhone 17 simulator device type. It also runs the
host binding checks. It creates its own simulator, executes XCTest through the
generated Swift binding, removes the simulator, and links an unsigned device
test app. This empty app is a test host, not a consumer iOS application. The
runner writes xcresult and DerivedData under ignored build/. No account,
provisioning team or physical device is needed.

`android` requires cargo-ndk, an Android SDK/NDK, and Rust arm64/x86_64 Android
targets. It compiles both JNI libraries; on-device execution is not implied.
Host bindings currently support macOS/Linux; the iOS runner is macOS-only.
Windows native execution is not yet a proved target.

The runner downloads a named libsodium 1.0.22-stable source archive over HTTPS
and verifies a fixed SHA-256. The binding crate additionally verifies the
upstream minisign signature. Its required LATEST.tar.gz filename is only a
local alias for those pinned bytes. A changed upstream archive fails the hash
check; it never silently updates the backend. Cargo.lock pins Rust dependencies.
Use the runner before direct Cargo commands and run Cargo from this directory
so the local source configuration applies.

## What the experiment establishes

The original Android fixture comes from production tssrp6a and TweetNaCl.
Additional fixtures use the same generator and force short A/salt, a Unicode
password, and a leading-zero M1. Small private values are intentionally unsafe
public test inputs; they must never be used in a real login.

Each fixture checks 27 vector properties and 17 rejection cases, covering SRP
client/server shared secrets and evidence, base/transport keys, secretbox,
binary JSON framing, server-info authentication and resume challenge binding.
Foreign harnesses additionally corrupt M2 and JSON and assert typed errors.

The 27th check compares a complete second transcript using srp 0.7.0-rc.3
and crypto-bigint 0.7.5: A, x, verifier, k, padded u, client/server S, server B,
M1 and M2 all match the production oracle. Both backends are compiled into
this experiment; its binary sizes are not the cost of a selected single
shipping backend.

RustCrypto srp 0.6.0 performs all modular exponentiation via its public hooks.
The adapter supplies YA's existing password hashing and padded/minimal integer
encodings. Its high-level process_reply is incompatible with YA: it hashes
username:password and does not pad the public values. Its compute_m2 uses a
full digest, while YA hashes a minimal M1 integer. Those differences are tested
explicitly; no new SRP arithmetic or server protocol is introduced.

## Accepted backend and remaining production work

The 0.6.0 implementation uses num-bigint, which is not a constant-time or
zeroizing secret backend. This wrapper zeroizes selected owned byte buffers
but cannot repair the library's integer allocations or establish its security
suitability. Passing vectors and successful builds are not approval to ship
this candidate.

The 0.7 release candidate replaces num-bigint with crypto-bigint, whose
arithmetic is designed for constant-time use. Its own README still states
that SRP has never received an independent third-party audit. It is a
prerelease, and variable-time integer conversions/secret erasure in the
profile adapter still need review. Do not infer whole-protocol constant-time
behavior from the backend's design. The maintainer accepted pinned 0.7.0-rc.3
for the shared mobile core; this fixture-only adapter remains experimental.
These numbers are library releases, not versions of the SRP wire protocol.

"Review" means a bounded assessment of the pinned library and YA adapter,
followed by an explicit decision about remaining risks. It does not mean that
an independent formal audit is automatically required, or that the absence
of an audit proves a vulnerability. An AI-assisted code review can inform
that decision but does not constitute a cryptographic audit. The
[plan's review record](../../docs/tactical/138-ios-native-core-proof.md)
owns the findings and remaining production verification conditions. The
[mobile pairing contract](../../topics/mobile-server-pairing.md#ios-and-shared-rust-direction)
owns the accepted unchanged-server compatibility and platform sequence.

Keep this fixture verifier as test tooling. A production core needs a separate
authentication API with opaque session state; public-fixture JSON containing
passwords, private values and expected keys must not become its login API.

iOS links explicit static archive paths. The runner verifies that the final
app defines the Rust proof entry point and does not depend on a checkout-local
Rust dylib; an apparently working simulator is not enough to establish this.

The experiment also does not establish live socket login/resume, lifecycle
cancellation, WebView bridging, Keychain storage, TLS, relay mux, Android
instrumentation, physical-device behavior, or App Store readiness.
Swift uses the same 5.10 language mode as the reference iOS project; strict
Swift 6 concurrency is a later gate, not a claimed result here.
