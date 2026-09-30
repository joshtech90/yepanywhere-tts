import { realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { findHtmlRootAssetReferences } from "@yep-anywhere/shared";
import { getMimeType } from "hono/utils/mime";
import {
  isPathInsideDirectory,
  type createLocalResourcePathPolicy,
} from "../routes/local-resource-policy.js";
import { openMutableFileSnapshot } from "../routes/mutable-file-cache.js";
import { fileBytesResponse } from "./fileResponse.js";
import type { ArtifactVhostSite } from "./vhosts.js";

type PathPolicy = ReturnType<typeof createLocalResourcePathPolicy>;

const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Largest HTML root read to decide which assets it loads. */
const MAX_ROOT_SCAN_BYTES = 8 * 1024 * 1024;

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Request path segments, or null for any traversal, hidden or encoded escape. */
function requestSegments(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments = decoded.split("/").filter(Boolean);
  return segments.some((part) => part === ".." || part.startsWith("."))
    ? null
    : segments;
}

async function canonicalWithin(
  candidate: string,
  root: string,
): Promise<string | null> {
  try {
    const canonical = await realpath(candidate);
    return isPathInsideDirectory(canonical, root) ? canonical : null;
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return null;
    throw error;
  }
}

/**
 * Serve one request for a file or directory vhost, reading current contents.
 * A file answers at `/`, and, when it is HTML, at the paths of the assets its
 * elements load (`findHtmlRootAssetReferences`, the live file share's rule),
 * with its own directory as the site root. A directory serves the files under
 * it, `index.html` for a folder. Every served path must also pass the local
 * file policy. Access was decided by the caller.
 */
export async function serveVhostSite(
  request: Request,
  site: ArtifactVhostSite,
  policy: PathPolicy,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return text("Read only", 405);
  const url = new URL(request.url);
  const segments = requestSegments(url.pathname);
  if (!segments) return text("Invalid path", 400);
  let root: string;
  try {
    root = await realpath(site.path);
  } catch {
    return text("This address has nothing to serve", 404);
  }
  const rootStats = await stat(root);
  let target: string | null;
  if (rootStats.isDirectory()) {
    target = await canonicalWithin(resolve(root, ...segments), root);
    if (target && (await stat(target)).isDirectory()) {
      // Relative asset URLs resolve against the folder only with its slash.
      if (!url.pathname.endsWith("/"))
        return new Response(null, {
          status: 308,
          headers: { Location: `${url.pathname}/${url.search}` },
        });
      target = await canonicalWithin(resolve(target, "index.html"), root);
    }
  } else if (segments.length === 0) {
    target = root;
  } else {
    target = await htmlRootAsset(root, segments.join("/"));
  }
  if (!target) return text("Not found", 404);
  const allowed = await policy.resolveAllowedFilePath(target);
  if (!allowed.ok) return text(allowed.error, allowed.status);
  const snapshot = await openMutableFileSnapshot(target);
  if (!snapshot) return text("Not found", 404);
  if (snapshot.stats.size > MAX_FILE_BYTES) {
    await snapshot.handle.close();
    return text("File exceeds 64 MiB", 413);
  }
  const mime = getMimeType(target) ?? "application/octet-stream";
  return fileBytesResponse(request, snapshot.handle, snapshot.stats, mime);
}

/** `relativePath` when the HTML file `root` loads it through an element. */
async function htmlRootAsset(
  root: string,
  relativePath: string,
): Promise<string | null> {
  if (![".html", ".htm"].includes(extname(root).toLowerCase())) return null;
  const snapshot = await openMutableFileSnapshot(root);
  if (!snapshot) return null;
  let html: string;
  try {
    if (snapshot.stats.size > MAX_ROOT_SCAN_BYTES) return null;
    html = (await snapshot.handle.readFile()).toString("utf8");
  } finally {
    await snapshot.handle.close();
  }
  const referenced = findHtmlRootAssetReferences(html, basename(root)).some(
    (reference) => reference.path === relativePath,
  );
  if (!referenced) return null;
  const directory = dirname(root);
  return canonicalWithin(resolve(directory, relativePath), directory);
}
