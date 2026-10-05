import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

// These belong to the disposable measurement device, never the developer's
// simulators or the host launchd. Run 36898374886 remained at 0% idle for five
// minutes, led by diagnosticd and Screen Time extraction. Leave Siri/search
// enabled: text input can synchronously consult those services.
// Keep networking, apsd, securityd/trustd, WebKit, keyboard, camera, microphone,
// Photos storage and file/clipboard services enabled for the app's real paths.
const backgroundLabels = [
  "com.apple.diagnosticd",
  "com.apple.diagnosticextensionsd",
  "com.apple.ScreenTimeAgent",
  "com.apple.ScreenTimeSettingsAgent",
  "com.apple.chronod",
  "com.apple.photoanalysisd",
  "com.apple.photosface",
  "com.apple.amsengagementd",
  "com.apple.triald",
];

export async function prepareInputSimulator(simulator, runtime, profile, run) {
  if (!profile) return { name: "stock", disabledLabels: [] };
  if (profile !== "input-acceptance")
    throw new Error("Unknown YA_IOS_SIMULATOR_PROFILE");
  const [major, minor] = runtime.version.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 5))
    throw new Error("Input simulator overrides require iOS 18.5 or newer");
  if (!/^[0-9A-F-]{36}$/i.test(simulator))
    throw new Error("Expected the newly created simulator's UUID");
  const present = new Set(
    await readdir(join(runtime.runtimeRoot, "System/Library/LaunchDaemons")),
  );
  const disabledLabels = backgroundLabels.filter((label) =>
    present.has(`${label}.plist`),
  );
  for (const label of ["com.apple.diagnosticd", "com.apple.ScreenTimeAgent"])
    if (!disabledLabels.includes(label))
      throw new Error(`Input simulator runtime lacks expected ${label}`);

  // launchd_sim reads this per-device store at boot. Its private layout is
  // documented by https://github.com/MobAI-App/simslim/blob/main/disabled_store.go.
  // Verify the booted launchd state rather than trusting the file write.
  const store = join(
    "/private/var/tmp",
    `com.apple.CoreSimulator.SimDevice.${simulator}`,
  );
  const path = join(store, "disabled.plist");
  let entries = {};
  try {
    await readFile(path);
    entries = JSON.parse(
      await run(
        "plutil",
        ["-convert", "json", "-o", "-", path],
        undefined,
        true,
      ),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const label of disabledLabels) entries[label] = true;
  await mkdir(store, { recursive: true, mode: 0o700 });
  const temporary = `${path}.ya-input`;
  await writeFile(temporary, JSON.stringify(entries), {
    flag: "wx",
    mode: 0o600,
  });
  await run("plutil", ["-convert", "xml1", temporary]);
  await rename(temporary, path);
  console.log(
    `Input simulator profile: ${disabledLabels.length} background services disabled`,
  );
  return { name: profile, disabledLabels, store };
}

export async function verifyInputSimulator(simulator, profile, run) {
  if (profile.name === "stock") return;
  const state = await run(
    "xcrun",
    ["simctl", "spawn", simulator, "launchctl", "print-disabled", "system"],
    undefined,
    true,
  );
  for (const label of profile.disabledLabels) {
    const escaped = label.replaceAll(".", "\\.");
    if (!new RegExp(`"${escaped}"\\s*=>\\s*(true|disabled)`).test(state))
      throw new Error(`Input simulator override was not applied: ${label}`);
  }
  const disabled = [...state.matchAll(/"([^"]+)"\s*=>\s*(true|disabled)/g)].map(
    (match) => match[1],
  );
  const protectedLabels = new Set([
    "com.apple.securityd",
    "com.apple.trustd",
    "com.apple.apsd",
    "com.apple.cfprefsd",
    "com.apple.SpringBoard",
    "com.apple.nsurlsessiond",
    "com.apple.containermanagerd",
    "com.apple.runningboardd",
    "com.apple.tccd",
    "com.apple.assistantd",
    "com.apple.siriknowledged",
    "com.apple.searchd",
    "com.apple.intelligenceplatformd",
    "com.apple.intelligencecontextd",
    "com.apple.intelligenceflowd",
    "com.apple.intelligencetasksd",
  ]);
  for (const label of disabled)
    if (
      protectedLabels.has(label) ||
      /^com\.apple\.(WebKit|TextInput)/.test(label)
    )
      throw new Error(`Input simulator disabled an app service: ${label}`);
  profile.verified = true;
}

export async function removeInputSimulatorProfile(simulator) {
  if (!/^[0-9A-F-]{36}$/i.test(simulator))
    throw new Error("Expected the owned simulator's UUID for profile cleanup");
  await rm(
    join("/private/var/tmp", `com.apple.CoreSimulator.SimDevice.${simulator}`),
    { recursive: true, force: true },
  );
}
