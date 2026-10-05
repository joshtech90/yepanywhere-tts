import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { android } from "./android.mjs";
import { source } from "./sodium.mjs";
import { enableSwiftCancellation } from "./swift-cancellation.mjs";
const core = fileURLToPath(new URL("..", import.meta.url));
const phase = process.argv[2] ?? "test";
const env = {
  ...process.env,
  SODIUM_DIST_DIR: join(core, "build/sodium-source"),
};
for (const name of ["SODIUM_LIB_DIR", "SODIUM_SHARED", "SODIUM_USE_PKG_CONFIG"])
  delete env[name];
async function run(args) {
  await new Promise((done, fail) => {
    const child = spawn("cargo", args, { cwd: core, env, stdio: "inherit" });
    child.once("error", fail);
    child.once("close", (code) =>
      code === 0 ? done() : fail(new Error(`cargo ${args[0]} exited ${code}`)),
    );
  });
}
await source(join(core, "build"));
if (
  ["prepare", "build", "test"].includes(phase) &&
  process.platform === "darwin"
) {
  const target =
    phase === "build"
      ? "aarch64-apple-ios"
      : process.arch === "x64"
        ? "x86_64-apple-ios"
        : "aarch64-apple-ios-sim";
  await run(["build", "--locked", "--release", "--target", target, "--lib"]);
  await run([
    "run",
    "--locked",
    "--features",
    "bindgen",
    "--bin",
    "uniffi-bindgen",
    "--",
    "generate",
    join(core, `target/${target}/release/libya_mobile_core.a`),
    "--language",
    "swift",
    "--out-dir",
    resolve(core, "../ios/Generated"),
    "--no-format",
  ]);
  await enableSwiftCancellation(
    resolve(core, "../ios/Generated/ya_mobile_core.swift"),
  );
} else if (phase === "android") {
  await android({ core, env, run });
} else if (phase === "rust") {
  await run(["fmt", "--check"]);
  await run(["test", "--locked"]);
  await run([
    "clippy",
    "--locked",
    "--all-targets",
    "--all-features",
    "--",
    "-D",
    "warnings",
  ]);
} else {
  throw new Error(`Unsupported core phase: ${phase}`);
}
