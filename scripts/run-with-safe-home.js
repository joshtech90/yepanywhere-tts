#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exitIfUnsafeHome } from "./safe-home.js";

const rawArgs = process.argv.slice(2);
let stdinNull = false;
let temporaryHomeRequested = false;
while (rawArgs[0]?.startsWith("--")) {
  const option = rawArgs.shift();
  if (option === "--stdin-null") {
    stdinNull = true;
    continue;
  }
  if (option === "--temporary-home") {
    temporaryHomeRequested = true;
    continue;
  }
  console.error(`Unknown run-with-safe-home option: ${option}`);
  process.exit(1);
}
const [command, ...args] = rawArgs;

if (!command) {
  console.error(
    "Usage: node scripts/run-with-safe-home.js [--stdin-null] [--temporary-home] <command> [args...]",
  );
  process.exit(1);
}

exitIfUnsafeHome({ entrypoint: command });

// Tests bind Unix sockets under the child's TMPDIR, and macOS caps socket
// paths at 104 bytes. Its per-user tmpdir (/var/folders/.../T/) leaves too
// little room once nested, so POSIX roots start at /tmp when it is writable.
function createTemporaryRoot() {
  const prefix = "yep-anywhere-test-";
  if (process.platform !== "win32") {
    try {
      return mkdtempSync(join("/tmp", prefix));
    } catch {
      // Fall back to the platform tmpdir, e.g. in sandboxes without /tmp.
    }
  }
  return mkdtempSync(join(tmpdir(), prefix));
}

const temporaryRoot = temporaryHomeRequested
  ? createTemporaryRoot()
  : undefined;
const temporaryHome = temporaryRoot ? join(temporaryRoot, "home") : undefined;
const temporaryDirectory = temporaryRoot
  ? join(temporaryRoot, "tmp")
  : undefined;
if (temporaryHome && temporaryDirectory) {
  mkdirSync(temporaryHome);
  mkdirSync(temporaryDirectory);
}
let cleaned = false;
function cleanupTemporaryHome() {
  if (!temporaryRoot || cleaned) return;
  cleaned = true;
  rmSync(temporaryRoot, { recursive: true, maxRetries: 3, retryDelay: 100 });
}

// Node 24+ on Windows requires shell:true to spawn .cmd files (CVE-2024-27980).
// DEP0190 warns about unescaped args, but args come from package.json scripts, not user input.
const isWindows = process.platform === "win32";

const child = spawn(command, args, {
  stdio: [stdinNull ? "ignore" : "inherit", "inherit", "inherit"],
  env: temporaryHome
    ? {
        ...process.env,
        HOME: temporaryHome,
        USERPROFILE: temporaryHome,
        TMPDIR: temporaryDirectory,
        TEMP: temporaryDirectory,
        TMP: temporaryDirectory,
      }
    : process.env,
  ...(isWindows ? { shell: true } : {}),
});

child.on("exit", (code, signal) => {
  cleanupTemporaryHome();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  cleanupTemporaryHome();
  console.error(`Failed to start ${command}: ${error.message}`);
  process.exit(1);
});
