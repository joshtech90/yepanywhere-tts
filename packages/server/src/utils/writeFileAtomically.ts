import { randomUUID } from "node:crypto";
import { open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OWNER_READ_WRITE_FILE_MODE } from "./filePermissions.js";
import { syncDirectory } from "./syncDirectory.js";

/**
 * Write a file whole: stage it beside the target, then rename over the target,
 * so a concurrent reader sees either the old file or the new one. Failures
 * before publication leave the old file standing.
 *
 * With durable enabled, sync and close the staged file before publishing,
 * then sync the directory where supported. A directory-sync failure rejects
 * after publication; the new contents are visible but durability is uncertain.
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
  options: { mode?: number; durable?: boolean } = {},
): Promise<void> {
  const staging = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const mode = options.mode ?? OWNER_READ_WRITE_FILE_MODE;
    if (options.durable) {
      const file = await open(staging, "wx", mode);
      try {
        await file.writeFile(contents);
        await file.sync();
      } finally {
        await file.close();
      }
    } else {
      await writeFile(staging, contents, { mode });
    }
    await publish(staging, path);
    if (options.durable) await syncDirectory(dirname(path));
  } catch (error) {
    await rm(staging, { force: true }).catch(() => {});
    throw error;
  }
}

async function publish(staging: string, path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(staging, path);
      return;
    } catch (error) {
      // Windows can briefly lock a replacement during concurrent publication
      // or inspection. Retry only sharing/permission failures for 175 ms total;
      // permanent failures still leave the old file intact and remove staging.
      if (
        process.platform !== "win32" ||
        attempt === 3 ||
        !["EPERM", "EACCES", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw error;
      }
      await delay(25 * 2 ** attempt);
    }
  }
}
