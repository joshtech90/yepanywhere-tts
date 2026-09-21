import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { OWNER_READ_WRITE_FILE_MODE } from "./filePermissions.js";

/**
 * Write a file whole: stage it beside the target, then rename over the target,
 * so a concurrent reader sees either the old file or the new one and a failed
 * write leaves the old one standing.
 *
 * The staging name is unique per write. Two writers over one directory — two
 * processes, or two stores in one process, whose writes are serialized per
 * store only — would otherwise stage to the same name, and the loser's rename
 * fails with ENOENT. A failed write takes its staging file with it: these
 * files carry secrets, and the directory's only expected member is the
 * published one.
 *
 * The directory must already exist. Its mode is a separate decision, made
 * where the directory is created.
 */
export async function writeFileAtomically(
  path: string,
  contents: string | Uint8Array,
  options: { mode?: number } = {},
): Promise<void> {
  const staging = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(staging, contents, {
      mode: options.mode ?? OWNER_READ_WRITE_FILE_MODE,
    });
    await rename(staging, path);
  } catch (error) {
    await rm(staging, { force: true }).catch(() => {});
    throw error;
  }
}
