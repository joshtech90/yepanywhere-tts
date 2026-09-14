import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "ya-agent installed package "));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const options = {
  cwd: directory,
  // Package-manager environment settings are not portable npm configuration.
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(npm_config_|pnpm_)/i.test(key),
    ),
  ),
  encoding: "utf8",
  shell: process.platform === "win32",
};
try {
  cpSync(resolve(root, "dist/npm-package"), join(directory, "package"), {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).includes("node_modules"),
  });
  const packed = JSON.parse(
    execFileSync(
      npm,
      ["pack", "./package", "--json", "--ignore-scripts"],
      options,
    ),
  );
  execFileSync(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      packed[0].filename,
    ],
    { ...options, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      join(root, "scripts/agent-self-smoke.mjs"),
      join(directory, "node_modules", packed[0].name),
    ],
    { stdio: "inherit", timeout: 30000 },
  );
  if (process.argv.includes("--startup")) {
    for (const [script, args] of [
      [
        "test-runtime-preflight.mjs",
        [join(directory, "node_modules", packed[0].name)],
      ],
      [
        "test-sqlite-startup.mjs",
        ["ready", join(directory, "node_modules", packed[0].name)],
      ],
    ]) {
      execFileSync(process.execPath, [join(root, "scripts", script), ...args], {
        stdio: "inherit",
        timeout: 180000,
        env: options.env,
      });
    }
  }
  const bunRuntime = process.argv
    .find((arg) => arg.startsWith("--bun-runtime="))
    ?.slice("--bun-runtime=".length);
  if (bunRuntime) {
    execFileSync(
      resolve(bunRuntime),
      [
        join(root, "scripts/agent-self-smoke.mjs"),
        join(directory, "node_modules", packed[0].name),
      ],
      {
        stdio: "inherit",
        timeout: 30000,
        env: options.env,
      },
    );
    execFileSync(
      resolve(bunRuntime),
      [
        join(root, "scripts/test-runtime-renderer.mjs"),
        join(directory, "node_modules", packed[0].name),
      ],
      {
        stdio: "inherit",
        timeout: 30000,
        env: options.env,
      },
    );
    execFileSync(
      resolve(bunRuntime),
      [
        join(root, "scripts/test-sqlite-startup.mjs"),
        "ready",
        join(directory, "node_modules", packed[0].name),
        "bunx",
      ],
      {
        stdio: "inherit",
        timeout: 180000,
        // On Unix, prove the forced Bun executable does not rely on a PATH Node.
        env: {
          ...options.env,
          ...(process.platform === "win32" ? {} : { PATH: "/usr/bin:/bin" }),
        },
      },
    );
  }
} finally {
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
