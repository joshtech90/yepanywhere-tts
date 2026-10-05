/** Owned unchanged servers + production Rust/WebView in a minified Debug probe. */
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRelayServer } from "../../relay/src/server.js";
// @ts-expect-error The shared diagnostic fixture is an untyped ESM module.
import { startFixture } from "../../mobile-core/scripts/fixture.mjs";
const android = fileURLToPath(new URL("..", import.meta.url));
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adb = sdk ? resolve(sdk, "platform-tools/adb") : "adb";
const push = process.env.YA_NATIVE_PUSH_LIVE === "1";
const publicRelay = process.env.YA_NATIVE_PUBLIC_RELAY_LIVE === "1";
if (publicRelay && push)
  throw new Error(
    "Run public relay login and native push acceptance separately",
  );
let serial: string | undefined;
const children = new Set<ReturnType<typeof spawn>>();
async function run(command: string, args: string[], capture = false) {
  return await new Promise<string>((done, fail) => {
    const child = spawn(command, args, {
      cwd: android,
      env: process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    children.add(child);
    let text = "";
    child.stdout?.on("data", (data) => {
      text += data;
    });
    child.stderr?.on("data", (data) => {
      text += data;
    });
    child.once("error", fail);
    child.once("close", (code) => {
      children.delete(child);
      code === 0
        ? done(text)
        : fail(new Error(`${command} exited ${code}: ${text}`));
    });
  });
}
async function device(args: string[], capture = false) {
  return run(adb, ["-s", checkSerial(), ...args], capture);
}
function checkSerial() {
  if (!serial) throw new Error("No selected Android device");
  return serial;
}
const devices = (await run(adb, ["devices"], true))
  .split("\n")
  .filter((line) => /\tdevice$/.test(line))
  .map((line) => line.split("\t")[0]);
serial = process.env.ANDROID_SERIAL;
if (serial ? !devices.includes(serial) : devices.length !== 1)
  throw new Error("Select one authorized Android device using ANDROID_SERIAL");
serial ??= devices[0];
await run("./gradlew", [
  "assembleBundledDebug",
  "assembleBundledDebugAndroidTest",
  "-PyaNativeProbeCleartext=true",
  "-PyaNativeProbeMinify=true",
  "--warning-mode",
  "all",
  "--no-daemon",
]);
await device([
  "install",
  "-r",
  "app/build/outputs/apk/bundled/debug/app-bundled-debug.apk",
]);
await device([
  "install",
  "-r",
  "app/build/outputs/apk/androidTest/bundled/debug/app-bundled-debug-androidTest.apk",
]);
const interrupt = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const permission = "android.permission.POST_NOTIFICATIONS";
const previouslyGranted =
  push &&
  /POST_NOTIFICATIONS: granted=true/.test(
    await device(
      ["shell", "dumpsys", "package", "com.yepanywhere.mobile"],
      true,
    ),
  );
try {
  if (push)
    await device([
      "shell",
      "pm",
      "grant",
      "com.yepanywhere.mobile",
      permission,
    ]);
  for (const mux of publicRelay ? [true] : push ? [false] : [false, true]) {
    const relay =
      mux && !publicRelay
        ? await createRelayServer({
            port: 0,
            inMemoryDb: true,
            logLevel: "warn",
            disablePrettyPrint: true,
          })
        : undefined;
    let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
    let beta: Awaited<ReturnType<typeof startFixture>> | undefined;
    const reversed: number[] = [];
    try {
      const relayURL = publicRelay
        ? "wss://relay.yepanywhere.com/ws"
        : relay
          ? `ws://127.0.0.1:${relay.port}/ws`
          : undefined;
      // Public registration must never collide with another probe or host.
      const username = publicRelay
        ? `android-${randomUUID().replaceAll("-", "").slice(0, 24)}`
        : "ios-fixture";
      fixture = await startFixture({ relayURL, username });
      if (relay || push) {
        beta = await startFixture({ relayURL, username: "rust-beta" });
        const deadline = Date.now() + 30000;
        while (relay && relay.connectionManager.getActiveServers().length < 2) {
          if (Date.now() >= deadline)
            throw new Error("Owned relay registration timed out");
          await new Promise((done) => setTimeout(done, 50));
        }
      }
      for (const port of [
        fixture.port,
        ...(relay ? [relay.port] : []),
        ...(push && beta ? [beta.port] : []),
      ]) {
        await device(["reverse", `tcp:${port}`, `tcp:${port}`]);
        reversed.push(port);
      }
      const classes = publicRelay
        ? ["com.yepanywhere.mobile.web.YaNativeWebAppInstrumentedTest"]
        : push
          ? [
              "com.yepanywhere.mobile.notifications.NativePushBindingsInstrumentedTest",
              "com.yepanywhere.mobile.notifications.NativePushLiveInstrumentedTest",
            ]
          : [
              "com.yepanywhere.mobile.web.YaNativeWebAppInstrumentedTest",
              ...(relay
                ? []
                : ["com.yepanywhere.mobile.ui.YaHostSwitchInstrumentedTest"]),
              relay
                ? "com.yepanywhere.mobile.connection.YaRustRuntimeInstrumentedTest"
                : "com.yepanywhere.mobile.security.YaSecurityClientE2eInstrumentedTest",
            ];
      const options = {
        class: classes.join(","),
        yaProbeWsUrl: fixture.endpoint,
        yaProbeUsername: username,
        yaProbePassword: "native-fixture-password",
        ...(process.env.YA_NATIVE_NETWORK_LIFECYCLE === "1"
          ? { yaProbeNetworkLifecycle: "true" }
          : {}),
        ...(push && beta
          ? { yaNativePushLive: "true", yaProbeSecondWsUrl: beta.endpoint }
          : {}),
        yaProbeUploadBytes: String(relay ? 100 * 1024 * 1024 : 1024 * 1024),
        ...(relayURL ? { yaProbeRelayWsUrl: relayURL } : {}),
        ...(relay
          ? {
              yaProbeSecondUsername: "rust-beta",
              yaProbeRelayStatusUrl: `http://127.0.0.1:${relay.port}/status`,
            }
          : {}),
      };
      const args = Object.entries(options).flatMap(([key, value]) => [
        "-e",
        key,
        value,
      ]);
      console.log(
        `Android native acceptance: ${publicRelay ? "public TLS relay + login from Main + WebView" : push ? "native push + two hosts" : mux ? "mux + 100 MiB" : "direct + security"}`,
      );
      const evidence =
        "/sdcard/Android/data/com.yepanywhere.mobile/files/live-failures";
      await device(["shell", "rm", "-rf", evidence]);
      const output = await device(
        [
          "shell",
          "am",
          "instrument",
          "-w",
          "-r",
          ...args,
          "com.yepanywhere.mobile.test/androidx.test.runner.AndroidJUnitRunner",
        ],
        true,
      );
      console.log(output);
      // Keep launcher-recovery evidence even when the YA checks then pass.
      const hasEvidence = await device(["shell", "test", "-d", evidence], true)
        .then(() => true)
        .catch(() => false);
      if (hasEvidence) {
        const reports = resolve(
          android,
          "app/build/reports/native-live",
          mux ? "mux" : "direct",
        );
        await mkdir(reports, { recursive: true });
        await device(["pull", evidence, reports]);
      }
      if (
        !output.includes(
          `OK (${classes.length} test${classes.length === 1 ? "" : "s"})`,
        ) ||
        /FAILURES!!!|INSTRUMENTATION_FAILED/.test(output)
      ) {
        throw new Error(
          "Owned Android acceptance did not pass every expected test",
        );
      }
      if (push) {
        const captures = resolve(
          android,
          `../../.artifacts/ui-testing/native-push-${Date.now()}`,
        );
        await mkdir(captures, { recursive: true });
        for (const name of ["native-push-hosts.png", "native-push-session.png"])
          await device([
            "pull",
            `/sdcard/Android/data/com.yepanywhere.mobile/files/${name}`,
            resolve(captures, name),
          ]);
        console.log(`Native push captures: ${captures}`);
        const headlessClass =
          "com.yepanywhere.mobile.notifications.NativePushHeadlessInstrumentedTest";
        const instrument = async (method: string) => {
          const headlessArgs = Object.entries({
            ...options,
            class: `${headlessClass}#${method}`,
          }).flatMap(([key, value]) => ["-e", key, value]);
          const result = await device(
            [
              "shell",
              "am",
              "instrument",
              "-w",
              "-r",
              ...headlessArgs,
              "com.yepanywhere.mobile.test/androidx.test.runner.AndroidJUnitRunner",
            ],
            true,
          );
          if (
            !/OK \(1 test\)/.test(result) ||
            /FAILURES!!!|INSTRUMENTATION_FAILED/.test(result)
          )
            throw new Error(`Headless ${method} failed: ${result}`);
          return result;
        };
        try {
          const prepared = await instrument("prepare");
          const metadata =
            /INSTRUMENTATION_STATUS: nativePushPrepared=(\{[^\n]+\})/.exec(
              prepared,
            )?.[1];
          if (!metadata)
            throw new Error(
              "Headless preparation omitted its routing metadata",
            );
          const subscription = (
            JSON.parse(metadata) as { subscriptionId: string }
          ).subscriptionId;
          if (!/^[A-Za-z0-9_-]{22}$/.test(subscription))
            throw new Error("Malformed headless routing id");
          await device(["shell", "am", "kill", "com.yepanywhere.mobile"]);
          const pid = await device(
            ["shell", "pidof", "com.yepanywhere.mobile"],
            true,
          ).catch(() => "");
          if (pid.trim())
            throw new Error(
              "Headless acceptance requires no YA process before delivery",
            );
          const response = await fetch(
            `http://127.0.0.1:${fixture.port}/__probe/push`,
            { method: "POST" },
          );
          const submitted = (await response.json()) as { sent: number };
          if (!response.ok || submitted.sent !== 1)
            throw new Error("Headless event submission failed");
          // Prior physical FCM startup completed within 10 s; allow 4x that maximum.
          const deadline = Date.now() + 40_000;
          while (
            !(
              await device(["shell", "cmd", "notification", "list"], true)
            ).includes(`${subscription}:android-preview-session`)
          ) {
            if (Date.now() >= deadline)
              throw new Error("No headless native notification appeared");
            await new Promise((done) => setTimeout(done, 100));
          }
          console.log(
            "Headless Firebase delivery: native notification after verified absent YA process",
          );
        } finally {
          await instrument("cleanup");
        }
      }
    } finally {
      for (const port of reversed)
        await device(["reverse", "--remove", `tcp:${port}`]);
      await beta?.stop();
      await fixture?.stop();
      await relay?.close();
    }
  }
} finally {
  if (push && !previouslyGranted)
    await device([
      "shell",
      "pm",
      "revoke",
      "com.yepanywhere.mobile",
      permission,
    ]);
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
