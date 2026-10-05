import { readFile, stat } from "node:fs/promises";
import {
  type LinkedSite,
  type LinkedSiteInspector,
  walkLinkedSite,
} from "@yep-anywhere/shared";

/** How long a walk is reused before the files it inspected are rechecked. */
const RECHECK_MS = 2000;
/** Largest document a walk reads for its links; a larger one is a leaf. */
export const MAX_LINKED_DOCUMENT_BYTES = 8 * 1024 * 1024;

interface CachedLinkedSite {
  site: LinkedSite;
  checkedAt: number;
  /** Every path the walk inspected, with what it found there. */
  stamps: Map<string, string>;
}

const linkedSites = new Map<string, CachedLinkedSite>();

/**
 * Everything `rootPath` links to (`walkLinkedSite`), reused for a moment and
 * then for as long as no file the walk inspected has changed, appeared or
 * disappeared. `scope` separates walks whose inspectors differ, such as a
 * file vhost's and a public file share's.
 */
export async function cachedLinkedSite(
  scope: string,
  rootPath: string,
  inspect: LinkedSiteInspector,
): Promise<LinkedSite> {
  const key = `${scope}\0${rootPath}`;
  const cached = linkedSites.get(key);
  const now = Date.now();
  if (
    cached &&
    (now - cached.checkedAt < RECHECK_MS ||
      (await stampsCurrent(cached.stamps)))
  ) {
    cached.checkedAt = now;
    return cached.site;
  }
  const stamps = new Map<string, string>();
  const site = await walkLinkedSite(rootPath, async (path, document) => {
    stamps.set(path, await fileStamp(path));
    return inspect(path, document);
  });
  linkedSites.set(key, { site, checkedAt: now, stamps });
  return site;
}

/**
 * A walk inspector's answer for the document at `path`: its text when it is
 * at most `MAX_LINKED_DOCUMENT_BYTES`, else no content, so it is served but
 * not followed.
 */
export async function readLinkedDocument(
  path: string,
  size: number,
): Promise<{ content?: string }> {
  if (size > MAX_LINKED_DOCUMENT_BYTES) return {};
  try {
    return { content: await readFile(path, "utf8") };
  } catch (error) {
    // Still served; its links just are not followed.
    console.warn(`[LinkedSite] Cannot read ${path} for links`, error);
    return {};
  }
}

async function fileStamp(path: string): Promise<string> {
  try {
    const stats = await stat(path);
    return `${stats.mtimeMs}:${stats.size}:${stats.isFile()}`;
  } catch {
    return "missing";
  }
}

async function stampsCurrent(stamps: Map<string, string>): Promise<boolean> {
  for (const [path, stamp] of stamps)
    if ((await fileStamp(path)) !== stamp) return false;
  return true;
}
