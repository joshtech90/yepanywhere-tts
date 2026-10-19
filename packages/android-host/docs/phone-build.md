# On-phone native APK build and isolated Lab

The Pixel 9 proof requested a second host app for testing while the app owning
the agent keeps running. `tools/phone_build.py` preserves that experiment as a
reproducible, opt-in developer tool. It always builds `com.yepanywhere.host.lab`,
with a purple flask icon, Lab heading and port **13410**. The normal build host
remains `com.yepanywhere.host.experimental` on **13400**. Android assigns them
separate UIDs, app data, local credentials and provider profiles.

This is a native-shell build from the current checkout, including Machine
Control's existing storage Java sources. It is not a server/frontend rebuild,
Gradle/AGP parity claim, release signing pipeline or automatic host upgrade.
The [Android host contract](../../../topics/android-host.md) remains authoritative.

## Prepare once

Requirements: Python 3.11+, curl, JDK 17, authorized same-phone ADB, a local
Machine Control checkout containing `platforms/android/storage`, and an existing
private debug keystore with the standard `android` password. Alpine can install
`openjdk17-jdk` and `android-tools-adb` with apk. Keep a setup journal because
packages in the guest runtime can be replaced independently of persistent HOME.

Use a private guest build directory, especially when the source is on Android
shared storage. Do not install dependencies or put signing keys on a shared
volume that disallows execution/symlinks. The builder never installs an APK,
enrolls an ADB key, changes debugging listeners or resets the ADB server.
Explicitly connect a known same-phone serial before invoking it if needed.

For example, after setting local paths and an explicit serial:

```sh
python3 packages/android-host/tools/phone_build.py \
  --serial "$ANDROID_TEST_SERIAL" \
  --work-dir "$PHONE_BUILD_DIR" \
  --machine-control-root "$MC_CHECKOUT" \
  --keystore "$PRIVATE_DEBUG_KEYSTORE"
```

The output is `$PHONE_BUILD_DIR/phone-lab/android-host-lab-debug.apk` with a
`provenance.json` containing staged-source hashes, MC source hashes, source
revision, toolchain pins, APK hash and elapsed time. Keep the keystore private
and persistent: a newly generated debug key cannot update a same-package app
signed by a different key. The APK's public certificate identifies its signer;
it does not expose or recover the original private signing key.

`phone-toolchain.json` pins Google API 36 SDK archives and Termux ARM64 packages
by SHA-256. The SDK's Java tools run under musl's JDK. Google's Linux AAPT2 is
x86-64; Termux's Android AAPT2 and zipalign instead run in a unique Android-shell
scratch directory with their own extracted libraries. No Termux package is
installed into Alpine or Android. Native PRoot libraries and notices reuse the
existing `runtime/artifacts.json` pins; the MC license is packaged too. Scratch
is removed in `finally`; downloaded inputs and outputs remain cached locally.
Source overlays and generated BuildConfig/resources live only in the build
folder, so the ordinary Android source and release defaults remain unchanged.

Review SDK and package licenses before redistribution. This tool does not
broaden the experimental payload's existing distribution authorization.

## Inventory, install and verify

These tools support Android user 0 and same-phone loopback only. Their reports
belong in private build storage or a machine-local agent inventory, not in Git.
They contain public certificate fingerprints, package IDs, UIDs and hashes;
private signing keys and local access credentials are never emitted.

```sh
python3 packages/android-host/tools/phone_lab.py \
  --serial "$ANDROID_TEST_SERIAL" --work-dir "$PHONE_BUILD_DIR" inventory
python3 packages/android-host/tools/phone_lab.py \
  --serial "$ANDROID_TEST_SERIAL" --work-dir "$PHONE_BUILD_DIR" install
# Intentional same-signer update of an existing Lab; retains its app data:
python3 packages/android-host/tools/phone_lab.py \
  --serial "$ANDROID_TEST_SERIAL" --work-dir "$PHONE_BUILD_DIR" install --update
```

The installer verifies the signed artifact hash and actual manifest package,
refuses an existing app without `--update`, and requires the same signer for
updates. It never installs an APK with the protected host's package ID. A fresh
Lab gets an independent copy of runtime **system directories only**, using two
explicit `run-as` identities. It copies no HOME, provider profiles, local tokens,
projects, shared-volume contents or Android folder grants. The build host's
installed runtime must support `YEP_ANDROID_HOST_PORT`; its current native Lab
shell supplies 13410. This reuses installed runtime code, rather than claiming a
fresh payload build. Budget at least 1.6 GiB free before provisioning.

A failed fresh provision leaves only the owned Lab partially provisioned; it
never clears or automatically reinstalls either app. Inspect that Lab before
repairing it. An update does not overwrite an existing Lab runtime. Thus newer
APK code and its required runtime must still be checked together.

Start the current debug Lab without opening its UI, then run:

```sh
python3 packages/android-host/tools/host.py control \
  --serial "$ANDROID_TEST_SERIAL" --package com.yepanywhere.host.lab start
python3 packages/android-host/tools/phone_lab.py \
  --serial "$ANDROID_TEST_SERIAL" --work-dir "$PHONE_BUILD_DIR" verify
# Opt-in lifecycle test: stops/restarts only the Lab through protected ADB intents.
python3 packages/android-host/tools/phone_lab.py \
  --serial "$ANDROID_TEST_SERIAL" --work-dir "$PHONE_BUILD_DIR" verify --restart-lab
```

Verification checks both authenticated APIs, distinct local credentials and
cross-token rejection. The restart test additionally witnesses the original
host's unchanged PID and readiness while the Lab is force-stopped and restarted.
It scopes mutations to the exact Lab package; do not generalize it to arbitrary
package IDs. Both apps still share phone RAM, disk and networking. This proves a
bounded lifecycle boundary, not immunity to device-wide resets or memory pressure.

## Observed evidence and limits

On 2026-10-18, the initial five-Java-file shell built on the Pixel 9 in 29.421 s
with cached downloads; Java took 6.313 s, D8 8.918 s and resources 0.953 s.
The first purple Lab build took 28.341 s. Both servers responded independently,
then stopping/restarting the Lab preserved the controller's PID and API. Each
server accepted its own local token and rejected the other's. Native controls
and a fresh WebView onboarding screen were visually inspected on the phone.

After updating the checkout, the repository builder compiled the current host
and MC storage sources in 35.743 s, verified APK signing/manifest identity and
updated only the same-signer Lab. Public identity and lifecycle evidence are
emitted by the companion tool rather than embedding device selectors, signing
keys, screenshots or credentials in this document.

No provider inference, provider login, reboot, overnight/Doze survival or
long-duration resource isolation follows from these checks. Gradle lint,
minification/release behavior and the Linux payload build remain separate checks.

## Minimal Alpine development friction

The installed host is a small runtime, not a complete contributor workstation.
Check actual availability before planning a build: `command -v java javac npm
pnpm ssh`, `df -h "$HOME"`, `adb devices -l`, and `git status`. A previous setup
note is not evidence that a replaceable runtime still has those packages.

Observed on this phone during the build/commit experiment:

- Node was present without npm, pnpm or a JDK. Installing `openjdk17-jdk` enabled
  compilation; `npm` enabled installation of the repo-pinned pnpm 10.34.6 in a
  private tools directory. No whole-runtime apk upgrade was needed.
- SSH disappeared with runtime replacement too. `openssh-client` restored Git
  access using the already-persistent user configuration and keys. Do not
  print or copy those keys while diagnosing transport problems.
- Source on `/sdcard` cannot execute files or create dependency symlinks. A
  private Git worktree was needed for `pnpm install --frozen-lockfile`; the
  pnpm store and tool binaries also belong in private storage. Shared-storage
  source can still be read by the Python APK builder.
- Git rejected the new private worktree as dubious ownership under PRoot.
  An explicit `safe.directory` entry for that exact owned worktree fixed the
  check. Do not use a wildcard exception. The initial Husky prepare reported
  `fatal: not in a git directory`; rerunning after the ownership fix succeeded.
- OpenSSH's known-hosts update attempted an unsupported hardlink on shared
  storage. Later host verification failed. A private known-hosts file populated
  from GitHub's authenticated `https://api.github.com/meta` endpoint, with strict
  checking and automatic UpdateHostKeys disabled, restored verified Git access.
  This is an observed local repair, not a reason to disable host-key checking.
- Google SDK Linux AAPT2 is x86-64. Adding the SDK alone does not make an ARM64
  Alpine build usable. The pinned Android-native tools are a separate boundary
  from musl guest binaries. The usual glibc ARM64 downloads are not a fallback.
- ADB connections were lost between tool invocations. Explicit reconnecting to
  the previously configured serial worked; no listener or daemon reset was
  needed. Android refused background foreground-service starts under `run-as`;
  the current protected shell-intent control replaces that UI workaround.
- Repo-wide lint/format, typecheck and test attempts made partial progress but
  stalled for minutes in this guest. A bounded one-file Biome command completed
  with `RAYON_NUM_THREADS=1`; full checks still stalled with `BIOME_THREADS=1`
  and `RAYON_NUM_THREADS=1`. Typecheck remained at the shared build, and tests
  at shared Vitest startup. These are observed limitations, not diagnosed code
  failures or passing checks. The runs were stopped to keep this task bounded.
  Native APK compilation, signature/manifest checks, Python syntax compilation
  and the two focused host profile tests completed separately.

The committed [tooling gap](../../../gaps/android-host-on-phone-dev-tooling.md)
tracks packaging and qualification follow-ups. Keep machine-specific package
commands, inventories and repair history in the local setup journal. These
observations do not authorize replacing a host that owns an active agent turn.
