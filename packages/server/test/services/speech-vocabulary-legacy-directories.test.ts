import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { legacySpeechVocabularyDirectories } from "../../src/services/voice/legacy-vocabulary-directories.js";

it("names the configured directory first and the data directory last", () => {
  const directories = legacySpeechVocabularyDirectories("/data", {
    YEP_SCRATCH_DIR: "/scratch",
    XDG_CACHE_HOME: "/cache",
  });
  expect(directories).toHaveLength(4);
  expect(directories.at(0)?.startsWith("/scratch/speech-vocabulary-")).toBe(
    true,
  );
  expect(
    directories.at(1)?.startsWith(join("/cache", "yep-anywhere", "speech-")),
  ).toBe(true);
  expect(
    directories.at(2)?.startsWith(join(tmpdir(), "yep-anywhere", "speech-")),
  ).toBe(true);
  expect(directories.at(3)).toBe(join("/data", "speech-vocabulary"));
});

it("falls back to the home cache and omits an unset override", () => {
  const directories = legacySpeechVocabularyDirectories("/data", {});
  expect(directories).toHaveLength(3);
  expect(
    directories
      .at(0)
      ?.startsWith(join(homedir(), ".cache", "yep-anywhere", "speech-")),
  ).toBe(true);
});

it("keeps two data directories apart under one legacy root", () => {
  const leaf = (dataDir: string) =>
    legacySpeechVocabularyDirectories(dataDir, {
      YEP_SCRATCH_DIR: "/scratch",
    }).at(0);
  expect(leaf("/one")).not.toBe(leaf("/two"));
});

it("creates nothing, so every candidate can be probed", () => {
  const root = join(tmpdir(), `ya-legacy-vocabulary-absent-${process.pid}`);
  for (const dir of legacySpeechVocabularyDirectories(join(root, "data"), {
    YEP_SCRATCH_DIR: join(root, "scratch"),
    XDG_CACHE_HOME: join(root, "cache"),
  }))
    expect(existsSync(dir)).toBe(false);
  expect(existsSync(root)).toBe(false);
});
