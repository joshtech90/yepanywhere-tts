import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Matches Cargo.lock's Android platform verifier. The AAR is upstream's JNI
// helper, not a replacement trust store. Verify its bytes before Gradle sees it.
const verifierVersion = "0.2.0";
const verifierHash =
  "aa021794230fbc2f0be355999e2cf67398dd563de066a2e17001ffbd0b69101b";
const targets = [
  "aarch64-linux-android",
  "armv7-linux-androideabi",
  "i686-linux-android",
  "x86_64-linux-android",
];
const abis = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"];
export async function android({ core, env, run }) {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_HOME or ANDROID_SDK_ROOT is required");
  env.ANDROID_NDK_HOME = join(sdk, "ndk/28.2.13676358");
  env.ANDROID_NDK_ROOT = env.ANDROID_NDK_HOME;
  const generated = resolve(core, "../android/app/build/generated");
  const lock = await readFile(join(core, "Cargo.lock"), "utf8");
  if (
    !lock.includes(
      `name = "rustls-platform-verifier-android"\nversion = "${verifierVersion}"`,
    )
  )
    throw new Error(
      "Review the pinned Android TLS helper before changing its Cargo version",
    );
  await new Promise((done, fail) => {
    const child = spawn("rustup", ["target", "add", ...targets], {
      cwd: core,
      env,
      stdio: "inherit",
    });
    child.once("error", fail);
    child.once("close", (code) =>
      code === 0 ? done() : fail(new Error(`rustup exited ${code}`)),
    );
  });
  await run(["build", "--locked", "--lib"]);
  const library = join(
    core,
    "target/debug",
    process.platform === "darwin"
      ? "libya_mobile_core.dylib"
      : process.platform === "win32"
        ? "ya_mobile_core.dll"
        : "libya_mobile_core.so",
  );
  await run([
    "run",
    "--locked",
    "--features",
    "bindgen",
    "--bin",
    "uniffi-bindgen",
    "--",
    "generate",
    library,
    "--language",
    "kotlin",
    "--out-dir",
    join(generated, "rustBindings"),
    "--no-format",
  ]);
  // NDK 28 and explicit linker flags retain 16 KiB alignment on every ABI.
  const hostTag =
    process.platform === "darwin"
      ? "darwin-x86_64"
      : process.platform === "win32"
        ? "windows-x86_64"
        : "linux-x86_64";
  const bin = join(
    env.ANDROID_NDK_HOME,
    "toolchains/llvm/prebuilt",
    hostTag,
    "bin",
  );
  const suffix = process.platform === "win32" ? ".exe" : "";
  // Autoconf does not consume cargo-ndk's target-specific archive variables.
  // Apple's ar can silently create an empty archive from Android ELF objects.
  env.AR = join(bin, `llvm-ar${suffix}`);
  env.RANLIB = join(bin, `llvm-ranlib${suffix}`);
  env.SODIUM_DISABLE_PIE = "1";
  env.RUSTFLAGS = `${env.RUSTFLAGS ?? ""} -C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=16384 -C link-arg=-Wl,--no-undefined`;
  await run([
    "ndk",
    "--platform",
    "24",
    ...abis.flatMap((abi) => ["-t", abi]),
    "-o",
    join(generated, "rustJniLibs"),
    "build",
    "--locked",
    "--release",
    "--lib",
  ]);
  const aar = join(
    generated,
    `rustls-platform-verifier-${verifierVersion}.aar`,
  );
  let bytes = await readFile(aar).catch(() => undefined);
  if (
    !bytes ||
    createHash("sha256").update(bytes).digest("hex") !== verifierHash
  ) {
    const response = await fetch(
      `https://raw.githubusercontent.com/rustls/rustls-platform-verifier/maven-archive/android-release-support/maven/org/rustls/rustls-platform-verifier/${verifierVersion}/rustls-platform-verifier-${verifierVersion}.aar`,
    );
    if (!response.ok)
      throw new Error(`TLS helper download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== verifierHash)
      throw new Error("Android TLS helper checksum mismatch");
    await mkdir(generated, { recursive: true });
    await writeFile(aar, bytes);
  }
}
