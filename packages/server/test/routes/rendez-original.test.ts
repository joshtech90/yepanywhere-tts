import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createLocalImageRoutes } from "../../src/routes/local-image.js";

it("serves matching originals, preserves old uploads after overwrite, and checks original access", async () => {
  const root = await mkdtemp(join(tmpdir(), "rendez-image-"));
  try {
    const project = join(root, "project");
    const event = join(project, ".rendez", "delivered", "session", "event");
    await mkdir(event, { recursive: true });
    const snapshot = join(event, "file.png");
    const original = join(project, "screenshot.png");
    await writeFile(snapshot, "prepared");
    await writeFile(original, "original");
    const record = {
      path: snapshot,
      originalPath: original,
      sha256: createHash("sha256").update("original").digest("hex"),
    };
    await writeFile(join(event, "record.json"), JSON.stringify(record));
    const routes = createLocalImageRoutes({ allowedPaths: [project] });
    const url = `/?path=${encodeURIComponent(snapshot)}`;
    expect(await (await routes.request(url)).text()).toBe("prepared");
    expect(await (await routes.request(`${url}&rendezOriginal=1`)).text()).toBe(
      "original",
    );
    await writeFile(original, "replaced");
    expect(await (await routes.request(`${url}&rendezOriginal=1`)).text()).toBe(
      "prepared",
    );
    const outside = join(root, "outside.png");
    await writeFile(outside, "original");
    await writeFile(
      join(event, "record.json"),
      JSON.stringify({ ...record, originalPath: outside }),
    );
    expect(await (await routes.request(`${url}&rendezOriginal=1`)).text()).toBe(
      "prepared",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
