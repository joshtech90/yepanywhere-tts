import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { defaultHuggingFaceHubCache } from "./localSttRuntime.js";

/** Check the default Granite snapshot without loading weights or using the network. */
export async function graniteModelFilesPresent(
  model: string,
  cache = defaultHuggingFaceHubCache(),
): Promise<boolean> {
  try {
    const repo = join(cache, `models--${model.replaceAll("/", "--")}`);
    const revision = (
      await readFile(join(repo, "refs", "main"), "utf8")
    ).trim();
    const snapshot = join(repo, "snapshots", revision);
    const required = [
      "config.json",
      "preprocessor_config.json",
      "processor_config.json",
      "tokenizer_config.json",
      "tokenizer.json",
    ];
    const index = JSON.parse(
      await readFile(join(snapshot, "model.safetensors.index.json"), "utf8"),
    ) as { weight_map?: Record<string, unknown> };
    const shards = [...new Set(Object.values(index.weight_map ?? {}))];
    if (!shards.length || shards.some((name) => typeof name !== "string"))
      return false;
    const files = await Promise.all(
      [...required, ...(shards as string[])].map((name) =>
        stat(join(snapshot, name)),
      ),
    );
    // stat follows cache symlinks: an incomplete or missing blob is not ready.
    return files.every((file) => file.isFile() && file.size > 0);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return false;
    throw error;
  }
}
