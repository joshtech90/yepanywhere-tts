import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const isWindows = os.platform() === "win32";

/**
 * Detect adb: check PATH first, then common Android SDK locations.
 * Returns the path to adb, or null if not found.
 */
export async function detectAdb(): Promise<string | null> {
  // Optional tool discovery must not block the event loop or startup forever.
  const command = isWindows ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(command, ["adb"], {
      encoding: "utf-8",
      timeout: 5_000,
      windowsHide: true,
    });
    const result = stdout.split("\n")[0]?.trim();
    if (result) return result;
  } catch {
    // Not on PATH, try SDK locations
  }

  // Check common Android SDK locations
  const home = os.homedir();
  const candidates = isWindows
    ? [
        path.join(
          home,
          "AppData",
          "Local",
          "Android",
          "Sdk",
          "platform-tools",
          "adb.exe",
        ),
        path.join(
          process.env.LOCALAPPDATA || "",
          "Android",
          "Sdk",
          "platform-tools",
          "adb.exe",
        ),
      ]
    : [
        path.join(home, "Android", "Sdk", "platform-tools", "adb"),
        path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"),
        "/opt/android-sdk/platform-tools/adb",
      ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
