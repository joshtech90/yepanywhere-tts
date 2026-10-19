import { readFile } from "node:fs/promises";
import { FRAME_FIND_AGENT_SCRIPT } from "../packages/shared/dist/find/frameFindAgent.generated.js";
import { DEFAULT_PARENTS } from "./host.mjs";

/** One source for the hosted worker and the fixed APK shell. */
export async function loadShellAssets(parents = DEFAULT_PARENTS) {
  const assets = {};
  for (const name of ["bootstrap.js", "worker.js", "frame.js"])
    assets[name] = await readFile(new URL(name, import.meta.url), "utf8");
  assets["worker.js"] =
    `self.__YA_ARTIFACT_PARENTS__ = ${JSON.stringify(parents)};\n${assets["worker.js"]}`;
  assets["frame.js"] += `\n${FRAME_FIND_AGENT_SCRIPT}`;
  return assets;
}
