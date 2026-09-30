import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { enforceOwnerReadWriteFilePermissions } from "../utils/filePermissions.js";

/**
 * An append-only JSONL audit file under `<dataDir>/logs`: owner-only, with
 * appends serialized per file, and rotated to a gzip archive once it would
 * exceed `maxBytes`.
 */
export interface AuditLogOptions {
  /** File name without directory, ending in `.jsonl`. */
  fileName: string;
  maxBytes: number;
  /** Prefix for permission warnings, such as `[approval-audit]`. */
  label: string;
}

export interface AuditLog<Entry> {
  append(dataDir: string | undefined, entry: Entry): Promise<void>;
}

export function createAuditLog<Entry>(
  options: AuditLogOptions,
): AuditLog<Entry> {
  const { fileName, maxBytes, label } = options;
  const baseName = fileName.replace(/\.jsonl$/, "");
  let appendQueue = Promise.resolve();
  let rotationSequence = 0;

  async function rotateIfNeeded(
    filePath: string,
    nextLineBytes: number,
  ): Promise<string | undefined> {
    let stats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!stats.isFile() || stats.size + nextLineBytes <= maxBytes) {
      return undefined;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    rotationSequence += 1;
    const archivePath = path.join(
      path.dirname(filePath),
      `${baseName}.${timestamp}.${process.pid}-${rotationSequence}.jsonl`,
    );
    try {
      await fs.rename(filePath, archivePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    await enforceOwnerReadWriteFilePermissions(archivePath, label);
    return archivePath;
  }

  async function gzipArchive(archivePath: string): Promise<void> {
    const gzipPath = `${archivePath}.gz`;
    try {
      await pipeline(
        createReadStream(archivePath),
        createGzip(),
        createWriteStream(gzipPath, { mode: 0o600 }),
      );
      await enforceOwnerReadWriteFilePermissions(gzipPath, label);
      await fs.rm(archivePath, { force: true });
    } catch {
      await fs.rm(gzipPath, { force: true }).catch(() => undefined);
    }
  }

  async function appendNow(
    dataDir: string | undefined,
    entry: Entry,
  ): Promise<void> {
    if (!dataDir) return;
    const dir = path.join(dataDir, "logs");
    const filePath = path.join(dir, fileName);
    const line = `${JSON.stringify(entry)}\n`;
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await fs.chmod(dir, 0o700);
    }
    const archivePath = await rotateIfNeeded(filePath, Buffer.byteLength(line));
    await fs.appendFile(filePath, line, { mode: 0o600 });
    await enforceOwnerReadWriteFilePermissions(filePath, label);
    if (archivePath) await gzipArchive(archivePath);
  }

  return {
    append(dataDir, entry) {
      appendQueue = appendQueue
        .catch(() => undefined)
        .then(() => appendNow(dataDir, entry));
      return appendQueue;
    },
  };
}
