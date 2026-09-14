import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComputerControlService } from "../src/computer-control/service.js";
import { ServerSettingsService } from "../src/services/ServerSettingsService.js";

// Real public-feed acceptance: no local package, publisher, test key or provider
// substitute. Uses its own instance, grants and data; never controls a VM.
if (process.platform !== "win32")
  throw new Error("Run in an interactive Windows Node session");
const dataDir = await mkdtemp(path.join(tmpdir(), "ya-release-acceptance-"));
const settings = new ServerSettingsService({ dataDir });
await settings.initialize();
let service = new ComputerControlService(settings, dataDir);
let removed = false;
try {
  await service.setManagedEnabled(true);
  const deadline = Date.now() + 15 * 60_000;
  while (service.status().release.working) {
    if (Date.now() > deadline)
      throw new Error("Public release installation timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const installed = service.status();
  if (
    !installed.enabled ||
    !installed.release.installedVersion ||
    installed.release.error
  ) {
    throw new Error(
      installed.release.error ?? "Release was not installed and enabled",
    );
  }
  await service.setAutoUpdate(false);
  const selected = service.select("release-acceptance", true, "codex")!;
  // Read-only native request. Do not retain window names or desktop captures.
  const result = await selected.call("computer_control", {
    operation: "windows",
  });
  if (!result.success)
    throw new Error("Installed native window enumeration failed");
  await selected.close();
  await service.close();
  const reloadedSettings = new ServerSettingsService({ dataDir });
  await reloadedSettings.initialize();
  service = new ComputerControlService(reloadedSettings, dataDir);
  if (service.status().sessions.length || service.status().running)
    throw new Error("Restart restored authority or started a resident");
  const restarted = service.select("release-restart", true, "codex")!;
  if (
    !(await restarted.call("computer_control", { operation: "windows" }))
      .success
  )
    throw new Error("Cold startup from the installed copy failed");
  await restarted.close();
  await service.setManagedEnabled(false);
  await service.uninstall();
  removed = true;
  console.log(
    JSON.stringify({
      schema: "ya-computer-release-acceptance/v1",
      passed: true,
      version: installed.release.installedVersion,
      architecture: process.arch,
      publicDownload: true,
      nativeRead: true,
      coldRestart: true,
      removed: true,
    }),
  );
} finally {
  try {
    if (!removed) {
      await service.uninstall();
      removed = true;
    }
  } finally {
    await service.close();
    if (removed) await rm(dataDir, { recursive: true, force: true });
  }
}
