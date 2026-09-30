import type {
  GitUntrackedFileListResult,
  GitWorkingTreeFile,
  GitWorkingTreeFileListResult,
  GitWorktreeCoverage,
  LocalSourceRoot,
} from "@yep-anywhere/shared";
import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Context } from "hono";
import { Hono } from "hono";
import { PRINCIPAL_VARIABLE, type Principal } from "../auth/principal.js";
import { GIT_DECODE_PATHS_ARGS, runGit } from "../git/gitExec.js";
import { listLocallyExcludedPaths } from "../git/locallyExcluded.js";
import { compareWorktreePaths } from "../projects/projectWorktreeCoverage.js";
import type { ProjectScanner } from "../projects/scanner.js";
import type { DirtyFileEditorService } from "../services/DirtyFileEditorService.js";
import { GitUntrackedCacheService } from "../services/GitUntrackedCacheService.js";
import { createLocalResourcePathPolicy } from "./local-resource-policy.js";
import { resolveProjectPath } from "./projectParam.js";

const DEFAULT_WORKING_TREE_FILE_LIMIT = 50_000;
const MAX_WORKING_TREE_FILE_LIMIT = 50_000;
const WORKING_TREE_FILE_MAX_BUFFER = 64 * 1024 * 1024;

export interface GitWorkingTreeFilesDeps {
  scanner: ProjectScanner;
  dataDir: string;
  dirtyFileEditorService?: DirtyFileEditorService;
  untrackedCache?: GitUntrackedCacheService;
  /** The host file-access allow-set; without it `root` requests are refused. */
  allowedPaths?: string[] | (() => string[]);
  includeProjects?: () => boolean;
}

/**
 * Read-only current-content inventory for the Working Tree browser. The three
 * Git queries keep work proportional to repository size rather than status-row
 * count, and Git remains the owner of ignore/exclude semantics. The ignored
 * dimension covers only this clone's `.git/info/exclude` paths — see
 * {@link listLocallyExcludedPaths}.
 */
export function createGitWorkingTreeFilesRoutes(
  deps: GitWorkingTreeFilesDeps,
): Hono {
  const routes = new Hono();
  const untrackedCache =
    deps.untrackedCache ??
    new GitUntrackedCacheService({ dataDir: deps.dataDir });
  const pathPolicy =
    deps.allowedPaths !== undefined
      ? createLocalResourcePathPolicy({
          allowedPaths: deps.allowedPaths,
          scanner: deps.scanner,
          includeProjects: deps.includeProjects,
        })
      : undefined;

  /**
   * `root=<absolute path>`: a one-shot inventory of an allowed directory
   * outside the project, for browsing a path a session named. It holds no
   * watcher or cache and reads nothing under the project, which only
   * authorizes the request. Only the superuser may name a host path, as for
   * every other absolute-path read.
   */
  const listLocalSourceRoot = async (
    c: Context,
    requestedRoot: string,
    limit: number,
  ): Promise<Response> => {
    const principal = c.get(PRINCIPAL_VARIABLE) as Principal | undefined;
    if (principal && principal.kind !== "superuser") {
      return c.json({ error: "Superuser required" }, 403);
    }
    if (!pathPolicy) {
      return c.json({ error: "No file-access policy is configured" }, 403);
    }
    const resolved = await pathPolicy.resolveAllowedDirectory(requestedRoot);
    if (!resolved.ok) {
      return c.json({ error: resolved.error }, resolved.status);
    }
    try {
      const checkout = await findGitCheckoutRoot(resolved.directory);
      const rootPath =
        checkout && (await pathPolicy.isAllowedDirectory(checkout))
          ? checkout
          : resolved.directory;
      const inventory = checkout
        ? await listWorkingTreeFiles(rootPath, limit)
        : await listDirectoryFiles(rootPath, limit);
      const root: LocalSourceRoot = {
        path: rootPath,
        isGitRepo: checkout !== null,
        ...(resolved.file
          ? {
              requestedFile: relative(rootPath, resolved.file)
                .split(sep)
                .join("/"),
            }
          : {}),
      };
      return c.json({ ...inventory, root });
    } catch (error) {
      return gitError(c, error);
    }
  };

  routes.get("/:projectId/git/working-tree-files", async (c) => {
    const projectPath = await resolveProjectPath(c, deps.scanner);
    if (typeof projectPath !== "string") return projectPath;

    const limit = clampLimit(c.req.query("limit"));
    const requestedRoot = c.req.query("root");
    if (requestedRoot !== undefined) {
      return listLocalSourceRoot(c, requestedRoot, limit);
    }
    const coverage = {
      tracked: queryEnabled(c.req.query("tracked"), true),
      untracked: queryEnabled(c.req.query("untracked"), true),
      ignored: queryEnabled(c.req.query("ignored"), false),
    };
    try {
      const untracked = coverage.untracked
        ? await untrackedCache.all(projectPath)
        : undefined;
      return c.json(
        await listWorkingTreeFiles(projectPath, limit, untracked?.files, {
          coverage,
          untrackedTruncated: untracked?.truncated,
        }),
      );
    } catch (error) {
      return gitError(c, error);
    }
  });

  routes.get("/:projectId/git/untracked-files", async (c) => {
    const projectPath = await resolveProjectPath(c, deps.scanner);
    if (typeof projectPath !== "string") return projectPath;
    const path = c.req.query("path");
    if (path !== undefined && !isValidFolderPath(path)) {
      return c.json({ error: "Invalid untracked folder path" }, 400);
    }

    try {
      const result = await untrackedCache.query(projectPath, {
        ...(path ? { path } : {}),
        ...(c.req.query("q") ? { q: c.req.query("q") } : {}),
      });
      return c.json(decorateLastEditors(deps, projectPath, result));
    } catch (error) {
      return gitError(c, error);
    }
  });

  return routes;
}

export async function listWorkingTreeFiles(
  cwd: string,
  limit = DEFAULT_WORKING_TREE_FILE_LIMIT,
  cachedUntracked?: string[],
  options: {
    coverage?: GitWorktreeCoverage;
    untrackedTruncated?: boolean;
  } = {},
): Promise<GitWorkingTreeFileListResult> {
  const coverage = options.coverage ?? {
    tracked: true,
    untracked: true,
    ignored: false,
  };
  const [cached, deleted, untracked, ignored] = await Promise.all([
    coverage.tracked ? listPaths(cwd, ["--cached"]) : Promise.resolve([]),
    coverage.tracked ? listPaths(cwd, ["--deleted"]) : Promise.resolve([]),
    coverage.untracked
      ? (cachedUntracked ?? listPaths(cwd, ["--others", "--exclude-standard"]))
      : Promise.resolve([]),
    coverage.ignored
      ? listLocallyExcludedPaths(cwd, {
          maxBuffer: WORKING_TREE_FILE_MAX_BUFFER,
        })
      : Promise.resolve([]),
  ]);
  const deletedPaths = new Set(deleted);
  const trackedPaths = new Set(
    cached.filter((path) => !deletedPaths.has(path)),
  );
  const files: GitWorkingTreeFile[] = [
    ...Array.from(trackedPaths, (path) => ({
      path,
      tracked: true,
      kind: "tracked" as const,
    })),
    ...untracked
      .filter((path) => !trackedPaths.has(path))
      .map((path) => ({ path, tracked: false, kind: "untracked" as const })),
    ...ignored
      .filter((path) => !trackedPaths.has(path))
      .map((path) => ({ path, tracked: false, kind: "ignored" as const })),
  ].sort((a, b) => compareWorktreePaths(a.path, b.path));
  const truncated = Boolean(options.untrackedTruncated) || files.length > limit;

  return {
    files: files.length > limit ? files.slice(0, limit) : files,
    truncated,
    limit,
  };
}

/** The realpath of the checkout enclosing `directory`, or null outside Git. */
async function findGitCheckoutRoot(directory: string): Promise<string | null> {
  let stdout: string;
  try {
    ({ stdout } = await runGit(directory, ["rev-parse", "--show-toplevel"]));
  } catch {
    return null;
  }
  const toplevel = stdout.trim();
  return toplevel ? await realpath(toplevel) : null;
}

const MAX_DIRECTORY_WALK_DIRECTORIES = 20_000;

/**
 * Bounded breadth-first file inventory of a directory outside Git. `.git`
 * and symlinked directories are not entered, so the walk stays under `root`.
 */
export async function listDirectoryFiles(
  root: string,
  limit = DEFAULT_WORKING_TREE_FILE_LIMIT,
): Promise<GitWorkingTreeFileListResult> {
  const files: GitWorkingTreeFile[] = [];
  const pending = [""];
  let directoriesRead = 0;
  let truncated = false;
  while (pending.length > 0) {
    if (directoriesRead >= MAX_DIRECTORY_WALK_DIRECTORIES) {
      truncated = true;
      break;
    }
    const prefix = pending.shift() as string;
    directoriesRead += 1;
    let entries: Dirent[];
    try {
      entries = await readdir(join(root, prefix), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== ".git") pending.push(path);
      } else if (entry.isFile()) {
        files.push({ path, tracked: false, kind: "untracked" });
      }
    }
    if (files.length > limit) {
      truncated = true;
      break;
    }
  }
  files.sort((a, b) => compareWorktreePaths(a.path, b.path));
  return {
    files: files.length > limit ? files.slice(0, limit) : files,
    truncated,
    limit,
  };
}

async function listPaths(cwd: string, flags: string[]): Promise<string[]> {
  const { stdout } = await runGit(
    cwd,
    [...GIT_DECODE_PATHS_ARGS, "ls-files", "-z", ...flags],
    { maxBuffer: WORKING_TREE_FILE_MAX_BUFFER },
  );
  const paths = stdout.split("\0");
  if (paths.at(-1) === "") paths.pop();
  return paths;
}

function decorateLastEditors(
  deps: GitWorkingTreeFilesDeps,
  projectPath: string,
  result: GitUntrackedFileListResult,
): GitUntrackedFileListResult {
  const lastEditors =
    deps.dirtyFileEditorService?.editorsForPaths(projectPath, result.files) ??
    {};
  return Object.keys(lastEditors).length > 0
    ? { ...result, lastEditors }
    : result;
}

function isValidFolderPath(path: string): boolean {
  return (
    path.endsWith("/") &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path
      .split("/")
      .every((segment, index, segments) =>
        index === segments.length - 1
          ? segment === ""
          : segment !== "" && segment !== "." && segment !== "..",
      )
  );
}

function clampLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_WORKING_TREE_FILE_LIMIT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return DEFAULT_WORKING_TREE_FILE_LIMIT;
  return Math.min(MAX_WORKING_TREE_FILE_LIMIT, Math.max(1, value));
}

function queryEnabled(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw === "1" || raw === "true";
}

function gitError(c: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : "git command failed";
  return c.json({ error: message }, 500);
}
