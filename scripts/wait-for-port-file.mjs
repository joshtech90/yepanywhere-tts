import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/** A created file is not a published port until its contents are valid. */
export async function waitForPortFile(file, deadline, assertRunning) {
  let content;
  while (Date.now() < deadline) {
    assertRunning();
    try {
      content = readFileSync(file, "utf8").trim();
      const port = Number(content);
      if (
        /^\d+$/.test(content) &&
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65535
      )
        return port;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(50);
  }
  throw new Error(
    `No valid port published in ${file}: ${JSON.stringify(content)}`,
  );
}
