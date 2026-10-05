import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeFixtureDirectory } from "./remove-fixture-directory.mjs";

const root = mkdtempSync(join(tmpdir(), "ya-fixture-cleanup-"));
try {
  writeFileSync(join(root, "data"), "fixture");
  await removeFixtureDirectory(root);
  assert.equal(existsSync(root), false);
  await removeFixtureDirectory(root);
} finally {
  await removeFixtureDirectory(root);
}

if (process.platform === "win32") {
  for (const release of [true, false]) {
    const directory = mkdtempSync(join(tmpdir(), "ya-fixture-cwd-"));
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdin.once('data',()=>setTimeout(()=>process.exit(0),1000));process.stdout.write('ready');setInterval(()=>{},1000);",
      ],
      { cwd: directory, stdio: ["pipe", "pipe", "inherit"] },
    );
    const closed = new Promise((done) => child.once("close", done));
    try {
      await new Promise((done, fail) => {
        // Reuse the full startup smoke's Windows launch guard. The cleanup
        // deadline begins only after the child actually holds its cwd.
        const timer = setTimeout(
          () => fail(new Error("Cwd fixture failed to start")),
          120_000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          fail(error);
        });
        child.stdout.once("data", () => {
          clearTimeout(timer);
          done();
        });
        child.once("exit", () => {
          clearTimeout(timer);
          fail(new Error("Cwd fixture exited before readiness"));
        });
      });
      if (release) child.stdin.end("release");
      if (release) {
        // The real Windows cwd lock outlives the old 600ms retry allowance.
        await removeFixtureDirectory(directory);
        assert.equal(existsSync(directory), false);
      } else {
        await assert.rejects(
          removeFixtureDirectory(directory),
          (error) => error.code === "EBUSY" || error.code === "EPERM",
        );
        assert.equal(existsSync(directory), true);
      }
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await closed;
      await removeFixtureDirectory(directory);
    }
  }
}
console.log(
  `Fixture directory cleanup contract passed (${process.versions.bun ? "Bun" : "Node"}, ${process.platform})`,
);
