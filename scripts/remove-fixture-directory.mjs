import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const transient = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

export async function removeFixtureDirectory(path) {
  // Run 36892794005 exhausted Node's ~0.69s post-close deletion window.
  // Bun 1.3.14 parses maxRetries/retryDelay but never uses them for recursive
  // rm (src/runtime/node/node_fs.zig:5783). Retry explicitly on both runtimes;
  // 2.4s is ~3.5x that observed window. A persistent handle still fails.
  const start = performance.now();
  const deadline = start + 2400;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      await rm(path, { recursive: true, force: true });
      if (attempts > 1)
        console.log(
          `Fixture removal recovered after ${attempts} attempts, ${Math.round(performance.now() - start)} ms`,
        );
      return;
    } catch (error) {
      const remaining = deadline - performance.now();
      if (!transient.has(error.code) || remaining <= 0) throw error;
      await delay(Math.min(100, remaining));
    }
  }
}
