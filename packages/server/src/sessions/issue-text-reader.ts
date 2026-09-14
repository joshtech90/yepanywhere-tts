import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  parseCodexSessionEntry,
  type ClaudeSessionEntry,
  type CodexSessionEntry,
} from "@yep-anywhere/shared";
import {
  normalizeIssueEntries,
  tagCodexEntrySourceByteOffset,
} from "./normalization.js";
import type { IssueText } from "../services/issues/extract.js";

export interface IssueReadSegment {
  path: string;
  end?: number;
  ordinal?: boolean;
}
export interface IssueReadOptions {
  cursor?: string;
  signal: AbortSignal;
}
export interface IssueTextBatch {
  messages: IssueText[];
  cursor: string;
  done: boolean;
  partial: boolean;
  bytesRead: number;
}
interface Cursor {
  layout?: string;
  segment: number;
  offset: number;
  skipping: boolean;
  partial: boolean;
  boundary?: string;
  size?: number;
  mtime?: number;
  inode?: string;
}
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORD = 1024 * 1024;

/** Provider-owned bounded acquisition. No cache or readFile of the transcript. */
export async function readIssueTextBatch(
  provider: "claude" | "codex",
  segments: IssueReadSegment[],
  options: IssueReadOptions,
): Promise<IssueTextBatch> {
  const cursor: Cursor = options.cursor
    ? JSON.parse(options.cursor)
    : { segment: 0, offset: 0, skipping: false, partial: false };
  if (
    !Number.isSafeInteger(cursor.offset) ||
    cursor.offset < 0 ||
    !Number.isSafeInteger(cursor.segment) ||
    cursor.segment < 0
  )
    throw new Error("Invalid issue cursor");
  const layout = JSON.stringify(segments);
  if (cursor.layout !== undefined && cursor.layout !== layout) {
    cursor.segment = 0;
    cursor.offset = 0;
    cursor.boundary = undefined;
    cursor.mtime = undefined;
    cursor.inode = undefined;
    cursor.skipping = false;
  }
  cursor.layout = layout;
  const entries: Array<ClaudeSessionEntry | CodexSessionEntry> = [];
  let bytesRead = 0;
  let records = 0;
  let incomplete = false;
  let lastEntryStart = 0;
  const deadline = Date.now() + 30_000;
  while (
    cursor.segment < segments.length &&
    bytesRead < MAX_BYTES &&
    records < 2000 &&
    Date.now() < deadline
  ) {
    options.signal.throwIfAborted();
    const segment = segments[cursor.segment]!;
    const file = await open(segment.path, "r");
    try {
      const stats = await file.stat();
      const end = Math.min(stats.size, segment.end ?? stats.size);
      const fingerprint = async (offset: number) => {
        const length = Math.min(256, offset);
        const b = Buffer.alloc(length);
        const read = await file.read(b, 0, length, offset - length);
        bytesRead += read.bytesRead;
        return createHash("sha256").update(b).digest("hex");
      };
      if (
        cursor.offset > end ||
        (cursor.size === end &&
          cursor.mtime !== undefined &&
          cursor.mtime !== stats.mtimeMs) ||
        (cursor.inode !== undefined && cursor.inode !== String(stats.ino)) ||
        (cursor.boundary &&
          cursor.boundary !== (await fingerprint(cursor.offset)))
      ) {
        cursor.offset = 0;
        cursor.skipping = false;
      }
      let carry = Buffer.alloc(0);
      let lineStart = cursor.offset;
      const appendLine = (line: string, position: number): void => {
        if (!line.trim()) return;
        if (provider === "codex") {
          // Validate JSON separately: unknown provider records are harmless,
          // incomplete JSON is retained for the next source version.
          JSON.parse(line);
          const entry = parseCodexSessionEntry(line);
          if (entry) {
            lastEntryStart = position;
            entries.push(
              tagCodexEntrySourceByteOffset(
                entry,
                segment.ordinal && "ordinal" in entry
                  ? Number(entry.ordinal)
                  : position,
              ),
            );
          }
        } else {
          const entry = JSON.parse(line) as ClaudeSessionEntry;
          if (entry.type === "user" || entry.type === "assistant")
            entries.push(entry);
        }
      };
      while (
        cursor.offset < end &&
        bytesRead < MAX_BYTES - 256 &&
        records < 2000 &&
        Date.now() < deadline
      ) {
        options.signal.throwIfAborted();
        const buffer = Buffer.alloc(
          Math.min(64 * 1024, end - cursor.offset, MAX_BYTES - bytesRead - 256),
        );
        const read = await file.read(buffer, 0, buffer.length, cursor.offset);
        bytesRead += read.bytesRead;
        if (!read.bytesRead) break;
        const chunk = buffer.subarray(0, read.bytesRead);
        let start = 0;
        for (let i = 0; i < chunk.length; i++) {
          if (chunk[i] !== 10) continue;
          const part = chunk.subarray(start, i);
          if (!cursor.skipping && carry.length + part.length <= MAX_RECORD) {
            const line = Buffer.concat([carry, part]).toString("utf8");
            try {
              appendLine(line, lineStart);
            } catch {
              cursor.partial = true;
            }
          } else cursor.partial = true;
          carry = Buffer.alloc(0);
          cursor.skipping = false;
          records++;
          start = i + 1;
          lineStart = cursor.offset + start;
          if (records >= 2000) break;
        }
        const consumed = records >= 2000 ? start : chunk.length;
        if (records < 2000) {
          const suffix = chunk.subarray(start);
          if (carry.length + suffix.length > MAX_RECORD) {
            cursor.skipping = true;
            cursor.partial = true;
            carry = Buffer.alloc(0);
          } else if (!cursor.skipping) carry = Buffer.concat([carry, suffix]);
        }
        cursor.offset += consumed;
      }
      // Leave an incomplete record for the next batch/appended source, without losing its prefix.
      if (carry.length) {
        if (cursor.offset >= end) {
          try {
            appendLine(carry.toString("utf8"), lineStart);
          } catch {
            incomplete = true;
            cursor.offset = lineStart;
            cursor.partial = true;
          }
        } else cursor.offset = lineStart;
      }
      const last = entries.at(-1);
      if (
        provider === "codex" &&
        last?.type === "response_item" &&
        last.payload.type === "message" &&
        last.payload.role === "user" &&
        !incomplete &&
        cursor.offset < end
      ) {
        entries.pop();
        cursor.offset = lastEntryStart;
      }
      const after = await file.stat();
      if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs)
        throw new Error("Issue source changed during read");
      cursor.boundary = await fingerprint(cursor.offset);
      cursor.size = end;
      cursor.mtime = stats.mtimeMs;
      cursor.inode = String(stats.ino);
      if (cursor.offset >= end && cursor.segment < segments.length - 1) {
        cursor.segment++;
        cursor.offset = 0;
        cursor.boundary = undefined;
        cursor.mtime = undefined;
        cursor.inode = undefined;
      } else break;
    } finally {
      await file.close();
    }
  }
  const done =
    cursor.segment === segments.length - 1 &&
    (incomplete || cursor.offset >= (cursor.size ?? 0));
  return {
    messages: normalizeIssueEntries(provider, entries),
    cursor: JSON.stringify(cursor),
    done,
    partial: cursor.partial,
    bytesRead,
  };
}
