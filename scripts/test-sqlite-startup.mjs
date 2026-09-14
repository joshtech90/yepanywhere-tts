import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [expected, packageDir = "dist/npm-package", launchMode] =
  process.argv.slice(2);
assert.ok(
  ["ready", "unsupported"].includes(expected),
  "Pass ready or unsupported",
);
const entry = pathToFileURL(resolve(packageDir, "dist/index.js")).href;
// Windows provider coordination invokes PowerShell and ACL utilities. Keep
// their OS configuration while still isolating application/profile state.
const platformEnvironment = Object.fromEntries(
  [
    "PATH",
    "SystemRoot",
    "SystemDrive",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERNAME",
    "USERDOMAIN",
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
if (process.platform === "win32") {
  // CI runs under pwsh 7, but YA invokes powershell.exe (Windows PowerShell
  // 5.1). Inheriting pwsh's module path selects incompatible Security modules.
  platformEnvironment.PSModulePath = join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "Modules",
  );
}
for (const state of [
  "disabled",
  expected,
  ...(expected === "ready" ? ["error"] : []),
]) {
  const temporary = mkdtempSync(join(tmpdir(), "ya-sqlite-startup-"));
  const dataDir = join(temporary, "data");
  const portFile = join(temporary, "port");
  if (state === "error")
    mkdirSync(join(dataDir, "discovery.sqlite"), { recursive: true });
  // A minimal child environment isolates profiles, provider credentials, and
  // operator toggles. Stub outbound fetch so this smoke never contacts updates
  // or providers; parent requests still exercise the real local HTTP server.
  const child = spawn(
    process.execPath,
    launchMode === "bunx"
      ? ["x", "--bun", "--no-install", "yepanywhere"]
      : [
          "--input-type=module",
          "-e",
          `
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await import(${JSON.stringify(entry)});
  `,
        ],
    {
      cwd: launchMode === "bunx" ? resolve(packageDir, "../..") : temporary,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...platformEnvironment,
        TEMP: temporary,
        TMP: temporary,
        HOME: temporary,
        USERPROFILE: temporary,
        APPDATA: join(temporary, "AppData", "Roaming"),
        LOCALAPPDATA: join(temporary, "AppData", "Local"),
        XDG_CONFIG_HOME: join(temporary, "config"),
        XDG_DATA_HOME: join(temporary, "share"),
        NODE_ENV: "production",
        YEP_DATA_DIR: dataDir,
        // Normal startup must initialize SQLite without an opt-in variable.
        ...(state === "disabled" ? { YEP_SQLITE: "off" } : {}),
        // This uses the mock Claude provider. An explicit absent Codex path
        // avoids unrelated global npm/CLI discovery during startup on Windows.
        YEP_DESKTOP_CODEX_CLI_PATH: join(temporary, "codex-not-installed"),
        AUTH_DISABLED: "true",
        USE_MOCK_SDK: "true",
        ENABLED_PROVIDERS: "claude",
        VOICE_INPUT: "false",
        SERVE_FRONTEND: "false",
        HOST: "127.0.0.1",
        PORT: "0",
        PORT_FILE: portFile,
        MAINTENANCE_PORT: "0",
        OPEN_BROWSER: "false",
      },
    },
  );
  let output = "";
  let exited = false;
  let spawnError;
  const completion = new Promise((resolveExit) => {
    child.once("exit", () => {
      exited = true;
    });
    child.once("close", () => {
      resolveExit();
    });
    child.once("error", (error) => {
      spawnError = error;
      exited = true;
      resolveExit();
    });
  });
  const collect = (chunk) => {
    output = (output + chunk).slice(-8000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  try {
    // Cold PowerShell host probes can make full Windows startup substantially
    // slower than the SQLite initialization.
    const deadline =
      Date.now() + (process.platform === "win32" ? 120_000 : 30_000);
    while (!existsSync(portFile) && !exited && Date.now() < deadline)
      await delay(50);
    assert.ok(
      !exited && existsSync(portFile),
      `Server failed to start: ${spawnError ?? ""}\n${output}`,
    );
    const port = Number(readFileSync(portFile, "utf8"));
    // Publishing a listening port can precede the first responsive request
    // during cold Windows initialization. Readiness shares the startup budget;
    // a single timed-out GET must not reject an otherwise healthy launch.
    let response;
    let readinessError;
    while (!exited && Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/version`, {
          signal: AbortSignal.timeout(Math.min(10_000, deadline - Date.now())),
        });
        break;
      } catch (error) {
        readinessError = error;
        await delay(50);
      }
    }
    assert.ok(
      response,
      `Server never became responsive: ${readinessError}\n${output}`,
    );
    assert.equal(response.status, 200, output);
    const version = await response.json();
    assert.deepEqual(version.sqlite, { state });
    assert.equal(
      existsSync(
        join(temporary, ".yep-anywhere", "provider-installations", "codex-cli"),
      ),
      false,
      "Claude-only startup must not initialize the excluded Codex installation",
    );
    assert.equal(
      version.capabilities.includes("speech-vocabulary"),
      state === "ready",
    );
    assert.deepEqual(version.serverRuntime, {
      kind: process.versions.bun ? "bun" : "node",
      version: process.versions.bun ?? process.versions.node,
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
    let websocketTimeout;
    try {
      await new Promise((resolvePong, rejectPong) => {
        websocketTimeout = setTimeout(
          () => rejectPong(new Error("Packaged WebSocket ping timed out")),
          10_000,
        );
        socket.addEventListener("error", () =>
          rejectPong(new Error("Packaged WebSocket failed")),
        );
        socket.addEventListener("open", () =>
          socket.send(JSON.stringify({ type: "ping", id: "runtime-smoke" })),
        );
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.type === "pong" && message.id === "runtime-smoke")
            resolvePong();
        });
      });
    } finally {
      clearTimeout(websocketTimeout);
      socket.close();
    }
    if (state === "disabled" || state === "unsupported") {
      assert.equal(existsSync(join(dataDir, "discovery.sqlite")), false);
    }
    console.log(
      `SQLite server startup passed (${process.versions.bun ? "Bun" : "Node"}, ${state})`,
    );
  } finally {
    if (!exited) {
      if (process.platform === "win32") {
        // bunx owns a separate server child on Windows. Killing only the
        // launcher leaves that child holding its cwd and SQLite files open.
        // Bun's Windows spawnSync timeout can expire immediately. Keep this
        // asynchronous so the launcher pipes also drain while taskkill runs.
        await new Promise((resolveKill, rejectKill) => {
          const killer = spawn(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let killOutput = "";
          const collectKillOutput = (chunk) => {
            killOutput = (killOutput + chunk).slice(-2000);
          };
          killer.stdout.on("data", collectKillOutput);
          killer.stderr.on("data", collectKillOutput);
          const timer = setTimeout(() => {
            killer.kill();
            rejectKill(
              new Error(
                `Windows process-tree cleanup timed out: ${killOutput}`,
              ),
            );
          }, 10_000);
          killer.once("error", (error) => {
            clearTimeout(timer);
            rejectKill(error);
          });
          killer.once("close", (code) => {
            if (code === 0 || exited) {
              clearTimeout(timer);
              resolveKill();
            } else {
              // The target may finish naturally before taskkill opens it,
              // with Bun delivering its close event after the killer's.
              completion.then(() => {
                clearTimeout(timer);
                resolveKill();
              });
            }
          });
        });
      } else {
        child.kill("SIGTERM");
      }
    }
    const killTimer = setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 10_000);
    await completion;
    clearTimeout(killTimer);
    await rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}
