import type { Stats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";

export const MUTABLE_FILE_CACHE_CONTROL = "private, no-cache";

type MutableFileStats = Pick<Stats, "ctimeMs" | "mtimeMs" | "size">;

export type MutableFileOpener = (filePath: string) => Promise<FileHandle>;

export interface MutableFileSnapshot {
  handle: FileHandle;
  stats: Stats;
}

/** Open and validate the same descriptor that will supply response bytes. */
export async function openMutableFileSnapshot(
  filePath: string,
  openFile: MutableFileOpener = (path) => open(path, "r"),
): Promise<MutableFileSnapshot | null> {
  const handle = await openFile(filePath);
  let retained = false;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    retained = true;
    return { handle, stats };
  } finally {
    if (!retained) await handle.close();
  }
}

export interface MutableFileCacheMetadata {
  etag: string;
  lastModified: string;
  modifiedAtSeconds: number;
}

function validatorTimePart(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "0";
  return Math.trunc(milliseconds * 1_000).toString(16);
}

/**
 * Build a cheap weak validator for a mutable filesystem path. Size and mtime
 * cover ordinary writes; ctime also invalidates same-size replacements whose
 * mtime was deliberately preserved.
 */
export function createMutableFileCacheMetadata(
  stats: MutableFileStats,
): MutableFileCacheMetadata {
  const modifiedAtSeconds = Math.floor(stats.mtimeMs / 1_000);
  return {
    etag: `W/"${stats.size.toString(16)}-${validatorTimePart(stats.mtimeMs)}-${validatorTimePart(stats.ctimeMs)}"`,
    lastModified: new Date(modifiedAtSeconds * 1_000).toUTCString(),
    modifiedAtSeconds,
  };
}

export function mutableFileCacheHeaders(
  metadata: MutableFileCacheMetadata,
): Record<string, string> {
  return {
    "Cache-Control": MUTABLE_FILE_CACHE_CONTROL,
    ETag: metadata.etag,
    "Last-Modified": metadata.lastModified,
  };
}

function normalizeWeakEntityTag(value: string): string {
  return value.trim().replace(/^W\//i, "");
}

function ifNoneMatchMatches(value: string, etag: string): boolean {
  const normalizedCurrent = normalizeWeakEntityTag(etag);
  return value.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return (
      trimmed === "*" || normalizeWeakEntityTag(trimmed) === normalizedCurrent
    );
  });
}

/** Apply conditional-GET precedence for a mutable file representation. */
export function isMutableFileNotModified(
  requestHeaders: Headers,
  metadata: MutableFileCacheMetadata,
): boolean {
  const ifNoneMatch = requestHeaders.get("If-None-Match");
  if (ifNoneMatch !== null) {
    return ifNoneMatchMatches(ifNoneMatch, metadata.etag);
  }

  const ifModifiedSince = requestHeaders.get("If-Modified-Since");
  if (ifModifiedSince === null) return false;
  const sinceMs = Date.parse(ifModifiedSince);
  if (!Number.isFinite(sinceMs)) return false;
  return metadata.modifiedAtSeconds * 1_000 <= sinceMs;
}

export function createNotModifiedResponse(headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.delete("Content-Length");
  return new Response(null, { headers: responseHeaders, status: 304 });
}

type ByteRangeSelection =
  | { kind: "whole" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Select the bytes a GET asks for. Only one `bytes=` range is honored;
 * multiple ranges, malformed values, and an `If-Range` that does not match
 * the current `Last-Modified` fall back to the whole file, which RFC 9110
 * permits. A weak entity tag never satisfies `If-Range`.
 */
function selectByteRange(
  requestHeaders: Headers,
  size: number,
  metadata: MutableFileCacheMetadata,
): ByteRangeSelection {
  const header = requestHeaders.get("Range");
  if (header === null) return { kind: "whole" };
  const ifRange = requestHeaders.get("If-Range");
  if (ifRange !== null && ifRange.trim() !== metadata.lastModified) {
    return { kind: "whole" };
  }
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return { kind: "whole" };
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return { kind: "whole" };
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return { kind: "unsatisfiable" };
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return { kind: "whole" };
  return { kind: "range", start, end };
}

/**
 * Answer a GET from an open file snapshot, taking ownership of its handle:
 * `304` when the client's copy is current, `206` for one satisfiable byte
 * range (so media elements can seek without fetching the whole file), `416`
 * for an unsatisfiable one, otherwise the whole file. `headers` carries the
 * full-file representation headers, including `Content-Length`.
 */
export async function createMutableFileResponse(
  requestHeaders: Headers,
  snapshot: MutableFileSnapshot,
  metadata: MutableFileCacheMetadata,
  headers: Headers,
): Promise<Response> {
  let handle: FileHandle | undefined = snapshot.handle;
  try {
    if (isMutableFileNotModified(requestHeaders, metadata)) {
      return createNotModifiedResponse(headers);
    }
    const size = snapshot.stats.size;
    const responseHeaders = new Headers(headers);
    responseHeaders.set("Accept-Ranges", "bytes");
    const selection = selectByteRange(requestHeaders, size, metadata);
    if (selection.kind === "unsatisfiable") {
      responseHeaders.set("Content-Range", `bytes */${size}`);
      responseHeaders.set("Content-Length", "0");
      return new Response(null, { headers: responseHeaders, status: 416 });
    }
    const range =
      selection.kind === "range"
        ? { start: selection.start, end: selection.end }
        : { start: 0 };
    if (selection.kind === "range") {
      responseHeaders.set(
        "Content-Range",
        `bytes ${selection.start}-${selection.end}/${size}`,
      );
      responseHeaders.set(
        "Content-Length",
        String(selection.end - selection.start + 1),
      );
    }
    const stream = handle.createReadStream({ autoClose: true, ...range });
    handle = undefined;
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: responseHeaders,
      status: selection.kind === "range" ? 206 : 200,
    });
  } finally {
    await handle?.close();
  }
}
