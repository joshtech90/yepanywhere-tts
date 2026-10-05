import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startFixture } from "./fixture.mjs";
const fixture = await startFixture();
try {
  await new Promise((done, fail) => {
    const child = spawn(
      "cargo",
      [
        "test",
        "--locked",
        "--test",
        "live",
        "--",
        "--nocapture",
        "--ignored",
        "--test-threads=1",
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, YA_TEST_ENDPOINT: fixture.endpoint },
        stdio: "inherit",
      },
    );
    child.once("error", fail);
    child.once("close", (code) =>
      code === 0 ? done() : fail(new Error(`Live tests exited ${code}`)),
    );
  });
} finally {
  await fixture.stop();
}
