import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { graniteModelFilesPresent } from "../../src/services/voice/graniteModelCache.js";

let cache: string | undefined;
afterEach(async () => {
  if (cache) await rm(cache, { recursive: true });
});

it("requires metadata and every shard, following HF blob symlinks", async () => {
  cache = await mkdtemp(join(tmpdir(), "granite-cache-"));
  const model = "ibm-granite/granite-speech-4.1-2b";
  expect(await graniteModelFilesPresent(model, cache)).toBe(false);
  const repo = join(cache, "models--ibm-granite--granite-speech-4.1-2b");
  const snapshot = join(repo, "snapshots", "revision");
  await mkdir(join(repo, "refs"), { recursive: true });
  await mkdir(snapshot, { recursive: true });
  await writeFile(join(repo, "refs", "main"), "revision");
  for (const file of [
    "config.json",
    "preprocessor_config.json",
    "processor_config.json",
    "tokenizer_config.json",
    "tokenizer.json",
  ]) {
    await writeFile(join(snapshot, file), "{}");
  }
  await writeFile(
    join(snapshot, "model.safetensors.index.json"),
    JSON.stringify({
      weight_map: { a: "first.safetensors", b: "second.safetensors" },
    }),
  );
  await writeFile(join(snapshot, "first.safetensors"), "weights");
  await symlink(join(repo, "blob"), join(snapshot, "second.safetensors"));
  expect(await graniteModelFilesPresent(model, cache)).toBe(false);
  await writeFile(join(repo, "blob"), "weights");
  expect(await graniteModelFilesPresent(model, cache)).toBe(true);
  await writeFile(join(repo, "blob"), "");
  expect(await graniteModelFilesPresent(model, cache)).toBe(false);
});
