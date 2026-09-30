import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { Readable } from "node:stream";

/**
 * The bytes of one opened file as a GET or HEAD response: whole, or the one
 * byte range the request names. Closes `handle` unless it is streamed, when
 * the stream closes it.
 */
export async function fileBytesResponse(
  request: Request,
  handle: FileHandle,
  stats: Pick<Stats, "size">,
  mime: string,
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
  });
  if (new URL(request.url).searchParams.get("download") === "true")
    headers.set("Content-Disposition", "attachment");
  let start = 0;
  let end = stats.size - 1;
  const range = request.headers.get("Range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1]
        ? Number(match[1])
        : Math.max(0, stats.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    }
    if (
      !match ||
      (!match[1] && !match[2]) ||
      start > end ||
      start >= stats.size ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end)
    ) {
      await handle.close();
      headers.set("Content-Range", `bytes */${stats.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  const status = range ? 206 : 200;
  if (request.method === "HEAD" || stats.size === 0) {
    await handle.close();
    return new Response(null, { status, headers });
  }
  const stream = handle.createReadStream({ start, end, autoClose: true });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status,
    headers,
  });
}
