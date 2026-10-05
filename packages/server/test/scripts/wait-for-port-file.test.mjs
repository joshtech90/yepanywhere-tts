import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { waitForPortFile } from "../../../../scripts/wait-for-port-file.mjs";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function portFile() {
  const directory = mkdtempSync(join(tmpdir(), "ya-port-file-"));
  directories.push(directory);
  return join(directory, "port");
}

it("waits through creation and incomplete publication before returning a port", async () => {
  const file = portFile();
  const pending = waitForPortFile(file, Date.now() + 5000, () => {});
  writeFileSync(file, "");
  // The next poll observes an existing empty file, then an invalid port.
  await new Promise((resolve) => setTimeout(resolve, 100));
  writeFileSync(file, "65536");
  await new Promise((resolve) => setTimeout(resolve, 100));
  writeFileSync(file, "32123\n");
  await expect(pending).resolves.toBe(32123);
});
it("reports child exit rather than waiting for the publication deadline", async () => {
  await expect(
    waitForPortFile(portFile(), Date.now() + 5000, () => {
      throw new Error("child exited");
    }),
  ).rejects.toThrow("child exited");
});
it("reports invalid publication at the deadline", async () => {
  const file = portFile();
  writeFileSync(file, "not a port");
  await expect(waitForPortFile(file, Date.now() + 1, () => {})).rejects.toThrow(
    "No valid port",
  );
});
