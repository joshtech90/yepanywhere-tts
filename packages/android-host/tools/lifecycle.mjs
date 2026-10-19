#!/usr/bin/env node
/** Physical host lifecycle regression. Existing runtime/state are preserved.
 * Stops/restarts only the selected app; requests no provider turn.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
assert(
  args.length === 2 && args[0] === "--serial",
  "Use --serial EXPLICIT_TEST_DEVICE; this stops/restarts YA Host",
);
const serial = args[1];
const app = "com.yepanywhere.host.experimental";
const here = fileURLToPath(new URL("../", import.meta.url));
const control =
  process.env.MACHINE_CONTROL_ANDROID ||
  join(homedir(), "code/machine-control/platforms/android/bin/android-device");
const require = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const id = randomUUID();
const evidence = join(here, ".local", `lifecycle-${id}`);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const forwards = [];
let browser;
const xml = `/data/local/tmp/ya-host-${id}.xml`;
const marker = `files/state/lifecycle-${id}`;
const launchFile = "files/runtime/opt/host/launch.mjs";
const backup = `${launchFile}.lifecycle-${id}`;
let renamed = false;
const tabPreferences = "shared_prefs/native-tabs.xml";
let previousTabs;
let isolatedTabs = false;
const adb = (...words) =>
  execFileSync("adb", ["-s", serial, ...words], { timeout: 20000 });
const quote = (word) => `'${word.replaceAll("'", "'\\''")}'`;
const shell = (...words) =>
  adb("shell", words.map(quote).join(" ")).toString().trim();
const read = (path) => adb("shell", "-T", "run-as", app, "cat", path);
const native = (action, ...words) =>
  execFileSync(control, ["--serial", serial, action, ...words], {
    timeout: 30000,
  });
const doctor = JSON.parse(native("doctor", "--json"));
assert(
  doctor.ready && doctor.states.interaction === "unlocked",
  "Unlocked explicit test device required",
);
assert(
  !shell("dumpsys", "activity", "services", app).includes(
    `${app}/com.yepanywhere.host.HostService`,
  ),
  "Stop the host before this controlled test",
);

function controls() {
  shell("uiautomator", "dump", xml);
  const value = shell("cat", xml);
  const found = new Map();
  for (const node of value.matchAll(/<node\s[^>]+/g)) {
    const text = /\btext="([^"]*)"/.exec(node[0])?.[1].toLowerCase();
    const bounds = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node[0]);
    if (text && bounds) {
      const [, x1, y1, x2, y2] = bounds.map(Number);
      found.set(text, [
        String(Math.floor((x1 + x2) / 2)),
        String(Math.floor((y1 + y2) / 2)),
      ]);
    }
  }
  return found;
}
function tap(label, buttons = controls()) {
  const key = label.toLowerCase();
  const at =
    buttons.get(key) ??
    (key === "open yep anywhere"
      ? (buttons.get("start and open yep anywhere") ??
        buttons.get("open when ready"))
      : key === "/projects"
        ? [...buttons].find(
            ([text]) => text.endsWith("/projects") && !text.startsWith("✓ "),
          )?.[1]
        : undefined);
  assert(at, `Missing native control: ${label}`);
  shell("input", "tap", ...at);
}
function launcher() {
  // Actual launcher semantics bring the existing task/WebView back intact.
  shell(
    "am",
    "start",
    "-a",
    "android.intent.action.MAIN",
    "-c",
    "android.intent.category.LAUNCHER",
    "-f",
    "0x10200000",
    "-n",
    `${app}/com.yepanywhere.host.HostActivity`,
  );
}
async function poll(check, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error("Lifecycle observation deadline expired");
}
async function page() {
  await poll(() =>
    read("files/host-status.txt").toString().startsWith("Host process started"),
  );
  let pid;
  await poll(() => {
    try {
      pid = shell("pidof", `${app}:web`).split(" ")[0];
      return Boolean(pid);
    } catch {
      return false;
    }
  });
  let port;
  await poll(() => {
    if (
      !shell("cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)
    )
      return false;
    port = adb(
      "forward",
      "tcp:0",
      `localabstract:webview_devtools_remote_${pid}`,
    )
      .toString()
      .trim();
    forwards.push(port);
    return true;
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let selected;
  await poll(() => {
    selected = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().startsWith("http://127.0.0.1:13400/"));
    return Boolean(selected);
  });
  await selected.waitForFunction(
    () =>
      Boolean(document.querySelector("#root")?.children.length) &&
      !document.body.innerText.includes("Webpage not available"),
  );
  await selected.waitForURL((url) => url.pathname === "/projects");
  await selected
    .getByText(/^(Projects|Choose Your Theme)$/)
    .filter({ visible: true })
    .first()
    .waitFor();
  assert.deepEqual(
    await selected.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const values = [
        style.paddingTop,
        style.paddingRight,
        style.paddingBottom,
        style.paddingLeft,
      ].map(Number.parseFloat);
      probe.remove();
      return values;
    }),
    [0, 0, 0, 0],
    "Native system-bar/cutout padding must not reach WebView CSS again",
  );
  assert(
    shell("dumpsys", "activity", "activities")
      .split("\n")
      .some(
        (line) =>
          line.includes("ResumedActivity") &&
          line.includes("com.yepanywhere.host.LocalWebActivity"),
      ),
    "The inspected WebView must be the foreground activity",
  );
  return selected;
}
function capture(name) {
  native("screenshot", join(evidence, `${name}.png`));
}
async function disconnect() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
function stop() {
  shell("am", "force-stop", app);
}
const results = {};
function passed(name) {
  results[name] = true;
  console.log(`PASS ${name}`);
}
try {
  stop();
  try {
    shell("run-as", app, "test", "-f", tabPreferences);
    previousTabs = read(tabPreferences);
    writeFileSync(join(evidence, "native-tabs-backup.xml"), previousTabs, {
      mode: 0o600,
    });
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  isolatedTabs = true;
  shell("run-as", app, "rm", "-f", tabPreferences);
  execFileSync(
    "adb",
    ["-s", serial, "shell", "-T", "run-as", app, "tee", marker],
    { input: id, timeout: 10000 },
  );
  native("launch", app);
  tap("Open Yep Anywhere");
  let current = await page();
  passed("stoppedHostOpen");
  await current.evaluate((value) => {
    window.__yaHostLifecycle = value;
    location.hash = value;
  }, id);
  shell("input", "keyevent", "KEYCODE_HOME");
  launcher();
  tap("Open Yep Anywhere");
  await poll(
    async () =>
      (await current.evaluate(() => document.visibilityState)) === "visible",
  );
  assert.equal(await current.evaluate(() => window.__yaHostLifecycle), id);
  assert.equal(new URL(current.url()).hash, `#${id}`);
  passed("healthyResumePreservesDocument");

  tap("Home");
  assert(controls().has("open yep anywhere"));
  tap("Open Yep Anywhere");
  await poll(
    async () =>
      (await current.evaluate(() => document.visibilityState)) === "visible",
  );
  assert.equal(await current.evaluate(() => window.__yaHostLifecycle), id);
  passed("nativeHomePreservesDocument");
  capture("native-toolbar");

  tap("+");
  await disconnect();
  current = await page();
  assert.equal(new URL(current.url()).hash, "");
  assert.equal(
    browser.contexts()[0].pages().length,
    1,
    "Only one mounted WebView",
  );
  tap("Tabs 2");
  capture("native-tabs");
  tap("/projects"); // The original, unselected tab; the active row has a check.
  await disconnect();
  current = await page();
  assert.equal(
    new URL(current.url()).hash,
    `#${id}`,
    "Warm tab history retains fragments",
  );
  assert.equal(
    await current.evaluate(() => window.__yaHostLifecycle),
    undefined,
    "Tab switching reconstructs the document",
  );
  tap("Tabs 2");
  tap("×"); // Last row is the newly opened background tab.
  assert(controls().has("tabs 1"));
  passed("tabSwitchHistoryAndClose");

  // Terminate only this app's actual launch Node, keeping its UI alive. A
  // renderer-initiated uncached navigation must reveal native recovery.
  const uid = shell("run-as", app, "id", "-u");
  const nodes = shell("ps", "-A", "-o", "UID,PID,NAME")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row[0] === uid && row[2] === "node")
    .filter((row) =>
      read(`/proc/${row[1]}/cmdline`)
        .toString()
        .includes("/opt/host/launch.mjs"),
    );
  assert.equal(
    nodes.length,
    1,
    "Exactly this app's launch Node must be identified",
  );
  shell("run-as", app, "kill", "-TERM", nodes[0][1]);
  await poll(() =>
    read("files/host-status.txt").toString().startsWith("Host exited"),
  );
  await current
    .evaluate((value) => {
      const url = new URL(location.href);
      url.searchParams.set("lifecycle_probe", value);
      location.assign(url);
    }, id)
    .catch(() => {});
  await poll(() => controls().has("retry"), 15);
  capture("connection-recovery");
  tap("Retry");
  await disconnect();
  current = await page();
  assert(!new URL(current.url()).searchParams.has("lifecycle_probe"));
  passed("mainFrameFailureRetry");

  tap("Home");
  const buttons = controls();
  tap("Stop local host", buttons);
  tap("Stop host");
  // Resolve the current control after the confirmation window has gone. The
  // disposable native probe separately covers Start during the stopping phase.
  tap("Open Yep Anywhere");
  await disconnect();
  await page();
  passed("confirmedStopOpen");
  await disconnect();
  stop();
  native("launch", app);
  tap("Open Yep Anywhere");
  await page();
  assert.equal(read(marker).toString(), id);
  passed("processDeathReopenPreservesState");
  await disconnect();
  stop();

  // Restore the exact file even on assertion failure; never replace the root.
  writeFileSync(
    join(evidence, "recovery.json"),
    JSON.stringify({ serial, launchFile, backup }),
    { mode: 0o600 },
  );
  shell("run-as", app, "mv", launchFile, backup);
  renamed = true;
  native("launch", app);
  tap("Open Yep Anywhere");
  const missing = controls();
  assert(
    missing.has("retry") &&
      [...missing.keys()].some((t) => t.includes("runtime is not installed")),
  );
  capture("runtime-unavailable");
  shell("run-as", app, "mv", backup, launchFile);
  renamed = false;
  rmSync(join(evidence, "recovery.json"));
  tap("Retry");
  await page();
  passed("missingRuntimeRepairRetry");
  assert.equal(read(marker).toString(), id);
  writeFileSync(
    join(evidence, "summary.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  capture("failure");
  throw error;
} finally {
  await disconnect();
  stop();
  if (renamed) {
    shell("run-as", app, "mv", backup, launchFile);
    rmSync(join(evidence, "recovery.json"));
  }
  if (isolatedTabs) {
    if (previousTabs) {
      execFileSync(
        "adb",
        ["-s", serial, "shell", "-T", "run-as", app, "tee", tabPreferences],
        { input: previousTabs, timeout: 10000 },
      );
      shell("run-as", app, "chmod", "600", tabPreferences);
    } else shell("run-as", app, "rm", "-f", tabPreferences);
  }
  shell("run-as", app, "rm", "-f", marker);
  shell("rm", "-f", xml);
  for (const port of forwards) adb("forward", "--remove", `tcp:${port}`);
  console.log(`Private lifecycle evidence: ${evidence}`);
}
