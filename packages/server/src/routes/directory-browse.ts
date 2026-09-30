/**
 * Folder listing for the Cockpit's folder picker.
 *
 * A browser's own file dialog cannot name a folder on the server host, and on
 * a phone it would show the phone's files. The picker walks the host's
 * directories through this route instead. Limited users never reach it: the
 * route policy is default-deny and this path is not listed there.
 */
import { Hono } from "hono";
import type { Stats } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { expandHomePath } from "../utils/expandHomePath.js";

export interface DirectoryBrowseEntry {
  name: string;
  path: string;
}

export interface DirectoryBrowseResponse {
  path: string;
  parent: string | null;
  home: string;
  entries: DirectoryBrowseEntry[];
  truncated: boolean;
}

const MAX_ENTRIES = 500;
/** Names read from one folder at most, whatever kind they are. */
const MAX_SCANNED = 5000;
/** Links whose target is checked at most, in parallel. */
const MAX_LINKS_CHECKED = 200;
const MAX_PATH_LENGTH = 4096;

export function createDirectoryBrowseRoutes(
  limits: { maxScanned?: number } = {},
): Hono {
  const maxScanned = limits.maxScanned ?? MAX_SCANNED;
  const routes = new Hono();

  routes.get("/", async (c) => {
    const rawPath = c.req.query("path") ?? "~";
    const hidden = c.req.query("hidden") === "1";

    if (rawPath.length > MAX_PATH_LENGTH || rawPath.includes("\0")) {
      return c.json({ error: "Invalid path" }, 400);
    }

    const expanded = expandHomePath(rawPath);
    if (!isAbsolute(expanded)) {
      return c.json({ error: "Path must be absolute" }, 400);
    }

    const resolvedPath = resolve(expanded);
    if (resolvedPath.length > MAX_PATH_LENGTH || resolvedPath.includes("\0")) {
      return c.json({ error: "Invalid path" }, 400);
    }

    let targetStat: Stats;
    try {
      targetStat = await stat(resolvedPath);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return c.json({ error: "Directory not found" }, 404);
      }
      if (code === "EACCES" || code === "EPERM") {
        return c.json({ error: "Permission denied" }, 403);
      }
      return c.json({ error: "Failed to access directory" }, 500);
    }

    if (!targetStat.isDirectory()) {
      return c.json({ error: "Not a directory" }, 400);
    }

    // Read at most MAX_SCANNED names, so a folder with a huge number of
    // entries costs a bounded amount of work; the rest counts as truncated.
    const directories: DirectoryBrowseEntry[] = [];
    const links: DirectoryBrowseEntry[] = [];
    let scanTruncated = false;
    try {
      const dir = await opendir(resolvedPath);
      let scanned = 0;
      for await (const dirent of dir) {
        if (++scanned > maxScanned) {
          scanTruncated = true;
          break;
        }
        if (!hidden && dirent.name.startsWith(".")) continue;
        const entry = {
          name: dirent.name,
          path: join(resolvedPath, dirent.name),
        };
        if (dirent.isDirectory()) directories.push(entry);
        else if (dirent.isSymbolicLink() && links.length < MAX_LINKS_CHECKED) {
          links.push(entry);
        }
      }
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === "EACCES" || code === "EPERM") {
        return c.json({ error: "Permission denied" }, 403);
      }
      return c.json({ error: "Failed to read directory" }, 500);
    }

    // A link counts when it leads to a folder; broken links are left out.
    const linkedDirectories = await Promise.all(
      links.map(async (entry) => {
        try {
          return (await stat(entry.path)).isDirectory() ? entry : null;
        } catch {
          return null;
        }
      }),
    );
    const entries = [
      ...directories,
      ...linkedDirectories.filter(
        (entry): entry is DirectoryBrowseEntry => entry !== null,
      ),
    ];

    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    const truncated = scanTruncated || entries.length > MAX_ENTRIES;
    const parentDir = dirname(resolvedPath);
    const parent = parentDir === resolvedPath ? null : parentDir;

    const response: DirectoryBrowseResponse = {
      path: resolvedPath,
      parent,
      home: homedir(),
      entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
      truncated,
    };

    return c.json(response);
  });

  return routes;
}
