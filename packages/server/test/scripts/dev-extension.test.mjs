import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  publishExtensionBuild,
  startExtensionDevelopment,
} from "../../../../scripts/dev-extension.mjs";

async function stage(path, asset) {
  await mkdir(join(path, "assets"), { recursive: true });
  await writeFile(join(path, "assets", asset), asset);
  await writeFile(join(path, "manifest.json"), "{}");
  await writeFile(join(path, "index.html"), asset);
}

it("coalesces changes during a build and never publishes a stale or failed generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-extension-owner-"));
  let release;
  const held = new Promise((done) => {
    release = done;
  });
  let attempts = 0;
  let fail = false;
  const published = [];
  const owner = await startExtensionDevelopment({
    projectRoot: root,
    watchChanges: false,
    log: () => {},
    build: async (path, generation) => {
      const number = ++attempts;
      if (number === 1) await held;
      await stage(path, `${number}.js`);
      if (fail) throw new Error("syntax error");
      return { generation };
    },
    publish: async (path, output, metadata) => {
      published.push(metadata.generation);
      await publishExtensionBuild(path, output, metadata);
    },
  });
  try {
    await expect.poll(() => attempts).toBe(1);
    owner.rebuild();
    owner.rebuild();
    release();
    await owner.settled();
    expect(attempts).toBe(2);
    expect(published).toHaveLength(1);
    const marker = await readFile(join(owner.output, "dev-build.json"), "utf8");
    fail = true;
    owner.rebuild();
    await owner.settled();
    expect(await readFile(join(owner.output, "dev-build.json"), "utf8")).toBe(
      marker,
    );
    expect(await readFile(join(owner.output, "index.html"), "utf8")).toBe(
      "2.js",
    );
    fail = false;
    owner.rebuild();
    await owner.settled();
    expect(await readdir(join(owner.output, "assets"))).toEqual([
      "2.js",
      "4.js",
    ]);
    owner.rebuild();
    await owner.settled();
    expect(await readdir(join(owner.output, "assets"))).toEqual([
      "4.js",
      "5.js",
    ]);
    expect(
      await readdir(join(root, "node_modules/.cache/ya-extension-dev")),
    ).toEqual(["owner.json"]);
    await expect(
      startExtensionDevelopment({
        projectRoot: root,
        output: owner.output,
        watchChanges: false,
        build: async () => ({}),
        log: () => {},
      }),
    ).rejects.toThrow("already has an owner");
  } finally {
    release();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
