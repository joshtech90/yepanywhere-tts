import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GeminiProjectMap } from "../../src/projects/gemini-project-map.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("migrates legacy mappings once without writing into the provider store", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-map-storage-"));
  directories.push(root);
  const providerDir = join(root, "native", "tmp");
  await mkdir(providerDir, { recursive: true });
  const legacy = join(providerDir, "project-map.json");
  const destination = join(root, "ya-data", "gemini-project-map.json");
  const original = JSON.stringify({ hash: "/old-project" });
  await writeFile(legacy, original);
  const map = new GeminiProjectMap(destination, legacy);
  expect(await map.get("hash")).toBe("/old-project");
  expect(JSON.parse(await readFile(destination, "utf8"))).toEqual({
    hash: "/old-project",
  });
  await map.remove("hash");
  await map.add("new-hash", "/new-project");
  expect(await readFile(legacy, "utf8")).toBe(original);
  const reloaded = new GeminiProjectMap(destination, legacy);
  expect(await reloaded.get("hash")).toBeUndefined();
  expect(await reloaded.get("new-hash")).toBe("/new-project");
});

it("defaults to YA data storage outside the configured Gemini session tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "gemini-map-default-"));
  directories.push(root);
  vi.stubEnv("YEP_DATA_DIR", join(root, "ya-data"));
  vi.stubEnv("GEMINI_SESSIONS_DIR", join(root, "native", "tmp"));
  vi.resetModules();
  const { PROJECT_MAP_FILE, GEMINI_TMP_DIR } = await import(
    "../../src/projects/gemini-project-map.js"
  );
  expect(PROJECT_MAP_FILE).toBe(
    join(root, "ya-data", "gemini-project-map.json"),
  );
  expect(relative(GEMINI_TMP_DIR, PROJECT_MAP_FILE).startsWith("..")).toBe(
    true,
  );
});
