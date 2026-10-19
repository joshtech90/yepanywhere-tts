import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  type createLocalResourcePathPolicy,
  LOCAL_MEDIA_CONTENT_TYPES,
} from "./local-resource-policy.js";

/** An overwritten incoming original must never replace the historical attachment. */
export async function readRendezOriginal(
  snapshotPath: string,
  policy: ReturnType<typeof createLocalResourcePathPolicy>,
): Promise<{ bytes: Buffer; contentType: string; path: string } | undefined> {
  if (!snapshotPath.split(path.sep).includes(".rendez")) return;
  const eventDir = path.dirname(snapshotPath);
  if (
    path.basename(path.dirname(path.dirname(eventDir))) !== "delivered" ||
    path.basename(path.dirname(path.dirname(path.dirname(eventDir)))) !==
      ".rendez"
  )
    return;
  try {
    const recordPath = path.join(eventDir, "record.json");
    const recordFile = await policy.resolveAllowedFilePath(recordPath);
    if (!recordFile.ok || recordFile.file.stats.size > 16_384) return;
    const record = JSON.parse(
      await readFile(recordFile.file.resolvedPath, "utf8"),
    );
    if (
      typeof record.path !== "string" ||
      typeof record.originalPath !== "string" ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    )
      return;
    const recordedSnapshot = await policy.resolveAllowedFilePath(record.path);
    if (
      !recordedSnapshot.ok ||
      recordedSnapshot.file.resolvedPath !== snapshotPath
    )
      return;
    const original = await policy.resolveAllowedFilePath(record.originalPath);
    if (!original.ok) return;
    const contentType =
      LOCAL_MEDIA_CONTENT_TYPES[
        path.extname(original.file.resolvedPath).toLowerCase()
      ];
    if (!contentType?.startsWith("image/")) return;
    const handle = await open(original.file.resolvedPath, "r");
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > 64 * 1024 * 1024) return;
      const bytes = Buffer.alloc(before.size);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!bytesRead) return;
        length += bytesRead;
      }
      const after = await handle.stat();
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        return;
      if (createHash("sha256").update(bytes).digest("hex") !== record.sha256)
        return;
      return { bytes, contentType, path: original.file.resolvedPath };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
