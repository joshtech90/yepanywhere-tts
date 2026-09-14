import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectQueueReadinessCheck } from "../../src/services/ProjectQueueReadinessCheck.js";

describe("ProjectQueueReadinessCheck", () => {
  let directory: string;
  let check: ProjectQueueReadinessCheck;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "queue-readiness-"));
    check = new ProjectQueueReadinessCheck();
  });

  afterEach(async () => {
    await check.dispose();
    await rm(directory, { recursive: true });
  });

  it("returns the occupied project's status line from a real executable", async () => {
    const result = await check.run(
      {
        executable: process.execPath,
        args: [
          "-e",
          "console.log('Editing ' + process.cwd()); process.exitCode = 1;",
        ],
      },
      directory,
    );
    expect(result).toEqual(`Editing ${await realpath(directory)}`);
  });

  it("clears on zero exit and passes arguments literally", async () => {
    expect(
      await check.run(
        {
          executable: process.execPath,
          args: [
            "-e",
            "process.exitCode = process.argv[1] === '$(touch unwanted)' ? 0 : 1",
            "$(touch unwanted)",
          ],
        },
        directory,
      ),
    ).toBeNull();
  });

  it("uses the first nonempty plain-text line and bounds the caption", async () => {
    expect(
      await check.run(
        {
          executable: process.execPath,
          args: [
            "-e",
            "console.log('\\n\\x1b[31mEditing parser\\x1b[0m\\nDetails'); process.exitCode = 1",
          ],
        },
        directory,
      ),
    ).toBe("Editing parser");
    const caption = await check.run(
      {
        executable: process.execPath,
        args: ["-e", "console.log('x'.repeat(1000)); process.exitCode = 1"],
      },
      directory,
    );
    expect(caption).toHaveLength(512);
  });

  it("reports missing executables and abnormal exits as failed checks", async () => {
    expect(
      await check.run(
        { executable: path.join(directory, "missing"), args: [] },
        directory,
      ),
    ).toBe("Readiness check failed (ENOENT)");
    expect(
      await check.run(
        { executable: process.execPath, args: ["-e", "process.exit(2)"] },
        directory,
      ),
    ).toBe("Readiness check failed (2)");
  });

  it("kills a timed-out check and allows another check", async () => {
    await check.dispose();
    check = new ProjectQueueReadinessCheck(100);
    expect(
      await check.run(
        {
          executable: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"],
        },
        directory,
      ),
    ).toBe("Readiness check timed out or was stopped");
    expect(
      await check.run(
        { executable: process.execPath, args: ["-e", "process.exit(0)"] },
        directory,
      ),
    ).toBeNull();
  });

  it("stops live checks on disposal", async () => {
    const pending = check.run(
      {
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
      directory,
    );
    await check.dispose();
    expect(await pending).toBe("Readiness check timed out or was stopped");
    expect(
      await check.run({ executable: process.execPath, args: [] }, directory),
    ).toBe("Readiness check stopped");
  });

  it.skipIf(process.platform === "win32")(
    "stops POSIX descendants that retain inherited pipes",
    async () => {
      await check.dispose();
      check = new ProjectQueueReadinessCheck(500);
      const heartbeat = path.join(directory, "heartbeat");
      const childScript =
        "const fs = require('node:fs'); fs.writeFileSync('heartbeat', 'x'); setInterval(() => fs.appendFileSync('heartbeat', 'x'), 20)";
      const result = await check.run(
        {
          executable: process.execPath,
          args: [
            "-e",
            `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'inherit' });`,
          ],
        },
        directory,
      );
      expect(result).toBe("Readiness check timed out or was stopped");
      const stopped = await readFile(heartbeat, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await readFile(heartbeat, "utf8")).toBe(stopped);
    },
  );

  it("bounds output and concurrent checks, and cancels an individual check", async () => {
    expect(
      await check.run(
        {
          executable: process.execPath,
          args: ["-e", "process.stdout.write('x'.repeat(10000))"],
        },
        directory,
      ),
    ).toBe("Readiness check exceeded its output limit");
    const controller = new AbortController();
    const command = {
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    };
    const pending = Array.from({ length: 4 }, () =>
      check.run(command, directory, controller.signal),
    );
    expect(await check.run(command, directory)).toBe(
      "Waiting for readiness check capacity",
    );
    controller.abort();
    expect(await Promise.all(pending)).toEqual(
      Array(4).fill("Readiness check timed out or was stopped"),
    );
    expect(
      await check.run(
        { executable: process.execPath, args: ["-e", "process.exit(0)"] },
        directory,
      ),
    ).toBeNull();
  });
});
