import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const core = fileURLToPath(new URL("..", import.meta.url));
const repo = resolve(core, "../..");
const build = join(core, "build");
const phase = process.argv[2] ?? "rust";
const phases = new Set(["rust", "bindings", "ios", "android", "all"]);
if (!phases.has(phase)) throw new Error(`Unknown proof phase: ${phase}`);

const env = { ...process.env, SODIUM_DIST_DIR: join(build, "sodium-source") };
// Never accidentally link a contributor's host library into a cross build.
for (const name of ["SODIUM_LIB_DIR", "SODIUM_SHARED", "SODIUM_USE_PKG_CONFIG"])
  delete env[name];

async function run(command, args, cwd = core, capture = false) {
  return await new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    const interrupt = () => child.kill("SIGTERM");
    process.once("SIGINT", interrupt);
    child.once("error", (error) => {
      process.removeListener("SIGINT", interrupt);
      fail(error);
    });
    child.once("close", (code) => {
      process.removeListener("SIGINT", interrupt);
      if (code === 0) done(output.trim());
      else fail(new Error(`${command} failed (${code})`));
    });
  });
}

async function source() {
  await mkdir(env.SODIUM_DIST_DIR, { recursive: true });
  const archive = join(env.SODIUM_DIST_DIR, "LATEST.tar.gz");
  const url =
    "https://download.libsodium.org/libsodium/releases/libsodium-1.0.22-stable.tar.gz";
  for (const [path, address] of [
    [archive, url],
    [`${archive}.minisig`, `${url}.minisig`],
  ]) {
    try {
      await stat(path);
    } catch {
      const response = await fetch(address, {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(`Sodium source download: ${response.status}`);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
    }
  }
  const hash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (
    hash !== "25c47d0cbf804bf28f3a1166dc145ee013e31a8dc78bb0c9d74273fb44260567"
  ) {
    throw new Error(
      "Pinned libsodium source hash mismatch; review before changing the pin",
    );
  }
  // libsodium-sys-stable additionally verifies the upstream minisign signature.
  console.log("Pinned libsodium 1.0.22-stable archive verified");
}

async function rust() {
  await run("pnpm", ["android:interop:check"], repo);
  await run(
    "pnpm",
    [
      "exec",
      "tsx",
      "--conditions",
      "source",
      "packages/mobile-core-proof/scripts/generate-vectors.ts",
    ],
    repo,
  );
  await run("cargo", ["fmt", "--all", "--check"]);
  await run("cargo", ["test", "--locked"]);
  await run("cargo", [
    "clippy",
    "--locked",
    "--all-targets",
    "--all-features",
    "--",
    "-D",
    "warnings",
  ]);
}

async function bindings() {
  if (!["darwin", "linux"].includes(process.platform))
    throw new Error("Host binding execution currently supports macOS/Linux");
  await run("cargo", ["build", "--locked", "--features", "bindgen"]);
  const library = join(
    core,
    "target/debug",
    process.platform === "darwin"
      ? "libya_mobile_core_proof.dylib"
      : "libya_mobile_core_proof.so",
  );
  const generated = join(build, "generated");
  await run("cargo", [
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
    join(core, "kotlin/build/generated"),
    "--no-format",
  ]);
  await run(join(repo, "packages/android/gradlew"), [
    "-p",
    join(core, "kotlin"),
    "run",
    "--no-daemon",
    "--console=plain",
    "--warning-mode=fail",
  ]);
  if (process.platform === "darwin") {
    await run("cargo", [
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
      "swift",
      "--out-dir",
      generated,
      "--no-format",
    ]);
    await run("swiftc", [
      "-warnings-as-errors",
      "-Xcc",
      `-fmodule-map-file=${generated}/ya_mobile_core_proofFFI.modulemap`,
      "-I",
      generated,
      "-L",
      join(core, "target/debug"),
      "-lya_mobile_core_proof",
      join(generated, "ya_mobile_core_proof.swift"),
      join(core, "swift/ProofSmoke.swift"),
      "-o",
      join(build, "swift-proof"),
    ]);
    await run(join(build, "swift-proof"), [repo, core]);
  }
}

async function ios() {
  if (process.platform !== "darwin")
    throw new Error("iOS proof requires macOS/Xcode");
  for (const target of ["aarch64-apple-ios-sim", "aarch64-apple-ios"]) {
    await run("cargo", [
      "build",
      "--locked",
      "--release",
      "--target",
      target,
      "--lib",
    ]);
    console.log(
      `${target} static archive bytes: ${(await stat(join(core, "target", target, "release/libya_mobile_core_proof.a"))).size}`,
    );
  }
  await run("cargo", [
    "run",
    "--locked",
    "--features",
    "bindgen",
    "--bin",
    "uniffi-bindgen",
    "--",
    "generate",
    join(
      core,
      "target/aarch64-apple-ios-sim/release/libya_mobile_core_proof.a",
    ),
    "--language",
    "swift",
    "--out-dir",
    join(core, "ios/Generated"),
    "--no-format",
  ]);
  await run("xcodegen", ["generate"], join(core, "ios"));
  const inventory = JSON.parse(
    await run("xcrun", ["simctl", "list", "--json"], core, true),
  );
  const runtime = inventory.runtimes
    .filter((r) => r.isAvailable && r.identifier.includes(".iOS-"))
    .sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    )[0];
  const phone = inventory.devicetypes.find((d) =>
    d.identifier.endsWith(".iPhone-17"),
  );
  if (!runtime || !phone)
    throw new Error("Need an available iOS runtime and iPhone-17 device type");
  const udid = await run(
    "xcrun",
    [
      "simctl",
      "create",
      "YA crypto proof",
      phone.identifier,
      runtime.identifier,
    ],
    core,
    true,
  );
  const project = join(core, "ios/YAProof.xcodeproj");
  const settings = [
    "-project",
    project,
    "-scheme",
    "YAProof",
    "-configuration",
    "Release",
    "-derivedDataPath",
    join(build, "DerivedData"),
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
  ];
  try {
    await run("xcrun", ["simctl", "boot", udid]);
    await run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
    const result = join(build, `ios-${Date.now()}.xcresult`);
    await run("xcodebuild", [
      ...settings,
      "-destination",
      `platform=iOS Simulator,id=${udid}`,
      "-parallel-testing-enabled",
      "NO",
      "-resultBundlePath",
      result,
      "test",
    ]);
    const app = join(
      build,
      "DerivedData/Build/Products/Release-iphonesimulator/YAProof.app/YAProof",
    );
    await inspectApp(app, "Simulator");
    await run("xcodebuild", [
      ...settings,
      "-destination",
      "generic/platform=iOS",
      "build",
    ]);
    await inspectApp(
      join(
        build,
        "DerivedData/Build/Products/Release-iphoneos/YAProof.app/YAProof",
      ),
      "Device",
    );
    console.log(`Simulator evidence: ${result}`);
  } finally {
    try {
      await run("xcrun", ["simctl", "shutdown", udid]);
    } finally {
      await run("xcrun", ["simctl", "delete", udid]);
    }
  }
}

async function inspectApp(path, label) {
  const dependencies = await run("xcrun", ["otool", "-L", path], core, true);
  if (dependencies.includes("libya_mobile_core_proof")) {
    throw new Error(
      "iOS proof must statically contain Rust, not load a host dylib",
    );
  }
  const symbols = await run("xcrun", ["nm", "-g", path], core, true);
  if (
    !/ T _uniffi_ya_mobile_core_proof_fn_func_verify_interop_fixture\b/m.test(
      symbols,
    )
  ) {
    throw new Error(
      "Rust proof entry point is missing from the linked iOS executable",
    );
  }
  console.log(
    `${label} statically linked app executable bytes: ${(await stat(path)).size}`,
  );
}

async function android() {
  await run("cargo", [
    "ndk",
    "--platform",
    "26",
    "-t",
    "arm64-v8a",
    "-t",
    "x86_64",
    "-o",
    join(build, "android-jni"),
    "build",
    "--locked",
    "--release",
    "--lib",
  ]);
  for (const abi of ["arm64-v8a", "x86_64"])
    console.log(
      `${abi} shared library bytes: ${(await stat(join(build, "android-jni", abi, "libya_mobile_core_proof.so"))).size}`,
    );
}

await source();
if (phase === "rust" || phase === "all") await rust();
if (["bindings", "ios", "all"].includes(phase)) await bindings();
if (phase === "ios" || phase === "all") await ios();
if (phase === "android" || phase === "all") await android();
