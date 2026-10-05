import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMutableFileCacheMetadata,
  createMutableFileResponse,
  createNotModifiedResponse,
  isMutableFileNotModified,
  mutableFileCacheHeaders,
  openMutableFileSnapshot,
} from "../../src/routes/mutable-file-cache.js";

const STATS = {
  ctimeMs: Date.UTC(2026, 7, 26, 8, 30, 1, 456),
  mtimeMs: Date.UTC(2026, 7, 26, 8, 30, 0, 789),
  size: 31_917,
};

describe("mutable file cache validators", () => {
  it("builds private revalidation headers from file metadata", () => {
    const metadata = createMutableFileCacheMetadata(STATS);

    expect(mutableFileCacheHeaders(metadata)).toEqual({
      "Cache-Control": "private, no-cache",
      ETag: metadata.etag,
      "Last-Modified": "Wed, 26 Aug 2026 08:30:00 GMT",
    });
    expect(metadata.etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+-[0-9a-f]+"$/);
  });

  it("uses weak entity-tag comparison and gives it date precedence", () => {
    const metadata = createMutableFileCacheMetadata(STATS);
    const strongEquivalent = metadata.etag.replace(/^W\//, "");

    expect(
      isMutableFileNotModified(
        new Headers({ "If-None-Match": `"other", ${strongEquivalent}` }),
        metadata,
      ),
    ).toBe(true);
    expect(
      isMutableFileNotModified(
        new Headers({
          "If-Modified-Since": metadata.lastModified,
          "If-None-Match": '"different"',
        }),
        metadata,
      ),
    ).toBe(false);
  });

  it("invalidates same-size files whose mtime was preserved", () => {
    const before = createMutableFileCacheMetadata(STATS);
    const after = createMutableFileCacheMetadata({
      ...STATS,
      ctimeMs: STATS.ctimeMs + 1,
    });

    expect(after.etag).not.toBe(before.etag);
  });

  it("accepts an unchanged Last-Modified timestamp at HTTP precision", () => {
    const metadata = createMutableFileCacheMetadata(STATS);

    expect(
      isMutableFileNotModified(
        new Headers({ "If-Modified-Since": metadata.lastModified }),
        metadata,
      ),
    ).toBe(true);
    expect(
      isMutableFileNotModified(
        new Headers({
          "If-Modified-Since": "Wed, 26 Aug 2026 08:29:59 GMT",
        }),
        metadata,
      ),
    ).toBe(false);
  });

  it("omits representation length from 304 responses", () => {
    const response = createNotModifiedResponse(
      new Headers({
        "Cache-Control": "private, no-cache",
        "Content-Length": "31917",
        ETag: createMutableFileCacheMetadata(STATS).etag,
      }),
    );

    expect(response.status).toBe(304);
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});

describe("mutable file byte ranges", () => {
  let dir: string;
  let filePath: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yep-range-"));
    filePath = path.join(dir, "digits.bin");
    await writeFile(filePath, "0123456789");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true });
  });

  async function respond(requestHeaders: Record<string, string>) {
    const snapshot = await openMutableFileSnapshot(filePath);
    if (!snapshot) throw new Error("fixture is not a file");
    const metadata = createMutableFileCacheMetadata(snapshot.stats);
    const headers = new Headers({
      ...mutableFileCacheHeaders(metadata),
      "Content-Length": String(snapshot.stats.size),
    });
    const response = await createMutableFileResponse(
      new Headers(requestHeaders),
      snapshot,
      metadata,
      headers,
    );
    return { response, metadata, text: await response.text() };
  }

  it("serves the whole file and advertises range support", async () => {
    const { response, text } = await respond({});
    expect(response.status).toBe(200);
    expect(text).toBe("0123456789");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("10");
  });

  it.each([
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=8-99", "89", "bytes 8-9/10"],
  ])("serves %s as a partial response", async (range, body, contentRange) => {
    const { response, text } = await respond({ Range: range });
    expect(response.status).toBe(206);
    expect(text).toBe(body);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(body.length));
  });

  it("refuses a range starting past the end", async () => {
    const { response, text } = await respond({ Range: "bytes=10-" });
    expect(response.status).toBe(416);
    expect(text).toBe("");
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
  });

  it.each(["bytes=0-1,4-5", "items=0-1", "bytes=5-2"])(
    "falls back to the whole file for %s",
    async (range) => {
      const { response, text } = await respond({ Range: range });
      expect(response.status).toBe(200);
      expect(text).toBe("0123456789");
    },
  );

  it("honors If-Range only for the current Last-Modified date", async () => {
    const current = await respond({});
    const matching = await respond({
      Range: "bytes=0-1",
      "If-Range": current.metadata.lastModified,
    });
    expect(matching.response.status).toBe(206);
    const stale = await respond({
      Range: "bytes=0-1",
      "If-Range": current.metadata.etag,
    });
    expect(stale.response.status).toBe(200);
    expect(stale.text).toBe("0123456789");
  });

  it("answers a current conditional request with 304 before ranges", async () => {
    const current = await respond({});
    const { response } = await respond({
      Range: "bytes=0-1",
      "If-None-Match": current.metadata.etag,
    });
    expect(response.status).toBe(304);
  });
});
