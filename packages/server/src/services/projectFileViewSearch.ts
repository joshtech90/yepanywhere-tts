import type { Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  FileViewSearchEntry,
  FileViewSearchResult,
  FileViewSearchTier,
} from "@yep-anywhere/shared";
import {
  isPathInsideDirectory,
  isSupportedAbsoluteLocalPath,
} from "../routes/local-resource-policy.js";
import type { ProjectFileCompletion } from "./projectFileCompletion.js";

const RESULT_LIMIT = 30;
/** Retained candidates whose ignore state and presence are rechecked. */
const RECHECK_LIMIT = 100;
/** Ranked candidates kept per inventory tier before the recheck. */
const TIER_MATCH_CAP = 1000;
/** Matches one unretained listing collects before it stops. */
const SCAN_MATCH_CAP = 100;
const SCAN_VISIT_BUDGET = 2_000_000;
const SCAN_TIME_MS = 8_000;

const TIER_ORDER: Record<FileViewSearchTier, number> = {
  path: 0,
  tracked: 1,
  untracked: 2,
  ignored: 3,
  outside: 4,
};

export interface FileViewSearchRequest {
  parts: readonly string[];
  /** Recently mentioned project-relative paths, most recent first. */
  recent: readonly string[];
  /** Scan ignored files when nothing else matches (submit, not completion). */
  includeIgnored: boolean;
}

type AllowedResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 403 | 404 };

/** The host file-access checks a superuser request may use. */
export interface FileViewHostAccess {
  resolveAllowedFilePath(path: string): Promise<AllowedResult>;
  resolveAllowedDirectory(path: string): Promise<AllowedResult>;
}

export class FileViewSearchError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404,
  ) {
    super(message);
  }
}

const EMPTY: FileViewSearchResult = {
  entries: [],
  pending: false,
  truncated: false,
};

/**
 * Tests paths against a `/v` request: an optional anchor that the path must
 * start with, then each needle as a substring in order after it. Any
 * uppercase letter in the request makes matching case-sensitive.
 */
class PartsMatcher {
  private readonly fold: (value: string) => string;
  private readonly anchor: string | null;
  private readonly needles: string[];

  constructor(anchor: string | null, needles: readonly string[]) {
    const all = anchor === null ? needles : [anchor, ...needles];
    const caseSensitive = all.some((part) => part !== part.toLowerCase());
    this.fold = caseSensitive
      ? (value) => value
      : (value) => value.toLowerCase();
    this.anchor = anchor === null ? null : this.fold(anchor);
    this.needles = needles.map(this.fold);
  }

  startsWithAnchor(path: string): boolean {
    return this.anchor !== null && this.fold(path).startsWith(this.anchor);
  }

  /**
   * Null when `path` does not match; otherwise whether the last needle hit
   * its basename, and the matched spans. Spans are omitted when case folding
   * changed the path's length, since their offsets would not line up.
   */
  match(path: string): Pick<Candidate, "basename" | "spans"> | null {
    const folded = this.fold(path);
    const spans: [number, number][] = [];
    let position = 0;
    if (this.anchor !== null) {
      if (!folded.startsWith(this.anchor)) return null;
      position = this.anchor.length;
      if (position) spans.push([0, position]);
    }
    let lastStart = -1;
    for (const needle of this.needles) {
      const start = folded.indexOf(needle, position);
      if (start < 0) return null;
      lastStart = start;
      position = start + needle.length;
      if (needle) spans.push([start, position]);
    }
    return {
      basename: lastStart > folded.lastIndexOf("/"),
      ...(folded.length === path.length ? { spans } : {}),
    };
  }
}

interface Candidate {
  path: string;
  tier: FileViewSearchTier;
  basename: boolean;
  spans?: [number, number][];
}

function toEntry({ path, tier, spans }: Candidate): FileViewSearchEntry {
  return spans?.length ? { path, tier, spans } : { path, tier };
}

function rankCandidates(
  candidates: Candidate[],
  recent: readonly string[],
): Candidate[] {
  const ranks = new Map(recent.map((path, index) => [path, index]));
  return candidates.sort(
    (a, b) =>
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      (ranks.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(b.path) ?? Number.MAX_SAFE_INTEGER) ||
      Number(b.basename) - Number(a.basename) ||
      a.path.length - b.path.length ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

function isHostPath(part: string): boolean {
  return part.startsWith("~/") || isSupportedAbsoluteLocalPath(part);
}

function stripDotSlash(part: string): string {
  return part.replace(/^(?:\.\/)+/, "");
}

/** A project-relative spelling with no absolute root or `..` segment. */
function isSafeRelative(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.split(/[\\/]/).some((segment) => segment === "..")
  );
}

async function projectEntryKind(
  project: string,
  path: string,
): Promise<"file" | "directory" | null> {
  if (!isSafeRelative(path)) return null;
  try {
    const stats = await stat(join(project, path));
    return stats.isFile() ? "file" : stats.isDirectory() ? "directory" : null;
  } catch {
    return null;
  }
}

/**
 * The project-relative spelling of an absolute path under the project root,
 * by its written spelling or its resolved one (a symlinked root such as
 * `~/ya`). `""` is the root itself; null is outside the project.
 */
async function projectRelativePath(
  project: string,
  written: string,
): Promise<string | null> {
  const lexical = resolve(written);
  const root = resolve(project);
  if (lexical === root) return "";
  if (isPathInsideDirectory(lexical, root))
    return relative(root, lexical).split(sep).join("/");
  let resolvedPath: string;
  let resolvedRoot: string;
  try {
    [resolvedPath, resolvedRoot] = await Promise.all([
      realpath(lexical),
      realpath(root),
    ]);
  } catch {
    return null;
  }
  if (resolvedPath === resolvedRoot) return "";
  return isPathInsideDirectory(resolvedPath, resolvedRoot)
    ? relative(resolvedRoot, resolvedPath).split(sep).join("/")
    : null;
}

/**
 * Stream one unretained listing into bounded matches. A time or visit budget
 * that runs out keeps what was found and reports truncation, as does
 * reaching the match cap.
 */
async function scanMatches(
  enumerate: (
    visit: (path: string) => boolean,
    signal: AbortSignal,
  ) => Promise<void>,
  matcher: PartsMatcher,
  tier: FileViewSearchTier,
  toPath: (path: string) => string,
): Promise<{ candidates: Candidate[]; truncated: boolean }> {
  const candidates: Candidate[] = [];
  let visited = 0;
  let truncated = false;
  const deadline = AbortSignal.timeout(SCAN_TIME_MS);
  try {
    await enumerate((path) => {
      if (++visited > SCAN_VISIT_BUDGET) {
        truncated = true;
        return false;
      }
      if (/\p{Cc}/u.test(path) || path.split("/").includes(".git")) return true;
      const matched = matcher.match(path);
      if (!matched) return true;
      const full = toPath(path);
      const shift = full.length - path.length;
      candidates.push({
        path: full,
        tier,
        basename: matched.basename,
        spans: matched.spans?.map(([start, end]) => [
          start + shift,
          end + shift,
        ]),
      });
      if (candidates.length < SCAN_MATCH_CAP) return true;
      truncated = true;
      return false;
    }, deadline);
  } catch (error) {
    if (!deadline.aborted) throw error;
    truncated = true;
  }
  return { candidates, truncated };
}

interface ProjectTarget {
  /** Leading part, anchored at the project root when it names a prefix. */
  first: string;
  rest: readonly string[];
  /** Anchor on `first` even if the retained inventory has no such prefix. */
  anchorRequired: boolean;
}

async function searchProject(
  completion: ProjectFileCompletion,
  project: string,
  target: ProjectTarget,
  request: FileViewSearchRequest,
): Promise<FileViewSearchResult> {
  const first = stripDotSlash(target.first);
  const { rest } = target;
  // A path named in full opens even when completion would never offer it,
  // such as an ignored run output an agent just wrote.
  const exact =
    rest.length === 0 && (await projectEntryKind(project, first)) === "file"
      ? first
      : null;
  return completion.withInventory(
    project,
    ["view", first, rest, target.anchorRequired, request],
    async (view) => {
      const anchorProbe = new PartsMatcher(first, []);
      const anchorEntry =
        target.anchorRequired || first.includes("/")
          ? view.entries.find((entry) =>
              anchorProbe.startsWithAnchor(entry.path),
            )
          : undefined;
      const anchored = target.anchorRequired || anchorEntry !== undefined;
      const matcher = anchored
        ? new PartsMatcher(first, rest)
        : new PartsMatcher(null, [first, ...rest]);

      const tracked: Candidate[] = [];
      const untracked: Candidate[] = [];
      let matched = 0;
      for (const entry of view.entries) {
        if (entry.kind !== "file" || entry.path === exact) continue;
        const hit = matcher.match(entry.path);
        if (!hit) continue;
        matched++;
        const bucket = entry.tracked ? tracked : untracked;
        if (bucket.length < TIER_MATCH_CAP)
          bucket.push({
            path: entry.path,
            tier: entry.tracked ? "tracked" : "untracked",
            ...hit,
          });
      }
      const selected = [
        ...rankCandidates(tracked, request.recent),
        ...rankCandidates(untracked, request.recent),
      ].slice(0, RECHECK_LIMIT);
      const eligible = await view.eligible(selected.map((entry) => entry.path));
      const entries: FileViewSearchEntry[] = [
        ...(exact ? [{ path: exact, tier: "path" as const }] : []),
        ...selected.filter((entry) => eligible.has(entry.path)).map(toEntry),
      ];
      let truncated =
        view.truncated ||
        matched > selected.length ||
        entries.length > RESULT_LIMIT;
      const pending = view.pending();

      // Ignored files cost a full unretained listing, so only a submit that
      // found nothing else, over a settled inventory, pays for one.
      if (entries.length === 0 && request.includeIgnored && !pending) {
        // A proven anchor names a real directory prefix; limiting the listing
        // to it keeps `/v runs/2026 out` from walking node_modules.
        const anchorSource = anchorEntry?.path ?? (anchored ? first : "");
        const directory = anchorSource.slice(0, first.lastIndexOf("/") + 1);
        const scan = await scanMatches(
          (visit, signal) =>
            view.enumerate(
              [
                "ls-files",
                "-z",
                "--others",
                "--ignored",
                "--exclude-standard",
                ...(directory ? ["--", `:(literal)${directory}`] : []),
              ],
              visit,
              signal,
            ),
          matcher,
          "ignored",
          (path) => path,
        );
        entries.push(
          ...rankCandidates(scan.candidates, request.recent).map(toEntry),
        );
        truncated ||= scan.truncated;
      }
      return {
        entries: entries.slice(0, RESULT_LIMIT),
        pending,
        truncated,
      };
    },
  );
}

async function searchDirectory(
  completion: ProjectFileCompletion,
  directory: string,
  needles: readonly string[],
  request: FileViewSearchRequest,
): Promise<FileViewSearchResult> {
  const matcher = new PartsMatcher(null, needles);
  const scan = (ignored: boolean) =>
    scanMatches(
      (visit, signal) =>
        completion.enumerateDirectory(
          directory,
          [
            "ls-files",
            "-z",
            "--others",
            ...(ignored ? ["--ignored"] : []),
            "--exclude-standard",
          ],
          visit,
          signal,
        ),
      matcher,
      "outside",
      (path) => join(directory, path),
    );
  return completion.withQuery(
    ["view-directory", directory, needles, request.includeIgnored],
    async () => {
      let result = await scan(false);
      if (result.candidates.length === 0 && request.includeIgnored)
        result = await scan(true);
      return {
        entries: rankCandidates(result.candidates, [])
          .slice(0, RESULT_LIMIT)
          .map(toEntry),
        pending: false,
        truncated: result.truncated || result.candidates.length > RESULT_LIMIT,
      };
    },
  );
}

/**
 * Resolve `/v` parts for one project. See `topics/view-command.md` for the
 * contract; `access` is absent for principals that may not name host paths.
 */
export async function searchFileView(
  completion: ProjectFileCompletion,
  project: string,
  request: FileViewSearchRequest,
  access: FileViewHostAccess | null,
  home = homedir(),
): Promise<FileViewSearchResult> {
  const [first, ...rest] = request.parts;
  if (first === undefined) return EMPTY;
  if (!isHostPath(first))
    return searchProject(
      completion,
      project,
      { first, rest, anchorRequired: false },
      request,
    );

  const written = first.startsWith("~/") ? join(home, first.slice(2)) : first;
  const inProject = await projectRelativePath(project, written);
  if (inProject !== null) {
    const isDirectory =
      inProject === "" ||
      (await projectEntryKind(project, inProject)) === "directory";
    return searchProject(
      completion,
      project,
      {
        first: isDirectory && inProject ? `${inProject}/` : inProject,
        rest,
        anchorRequired: true,
      },
      request,
    );
  }

  let stats: Stats | null = null;
  try {
    stats = await stat(written);
  } catch {
    stats = null;
  }
  if (!stats) {
    // A path from another checkout or machine: its longest suffix that exists
    // in this project stands in for it, so an agent's absolute path from a
    // sibling worktree still opens this project's copy.
    const components = written.split(/[\\/]+/).filter(Boolean);
    for (let index = 0; index < components.length; index++) {
      const suffix = components.slice(index).join("/");
      const kind = await projectEntryKind(project, suffix);
      if (kind === "file" && rest.length === 0)
        return { ...EMPTY, entries: [{ path: suffix, tier: "path" }] };
      if (kind === "directory")
        return searchProject(
          completion,
          project,
          { first: `${suffix}/`, rest, anchorRequired: true },
          request,
        );
    }
    return EMPTY;
  }

  if (!access)
    throw new FileViewSearchError(
      "Only the server owner can open paths outside the project",
      403,
    );
  if (stats.isFile()) {
    if (rest.length) return EMPTY;
    const allowed = await access.resolveAllowedFilePath(written);
    if (!allowed.ok)
      throw new FileViewSearchError(allowed.error, allowed.status);
    return { ...EMPTY, entries: [{ path: written, tier: "path" }] };
  }
  if (!stats.isDirectory()) return EMPTY;
  const allowed = await access.resolveAllowedDirectory(written);
  if (!allowed.ok) throw new FileViewSearchError(allowed.error, allowed.status);
  return searchDirectory(completion, written, rest, request);
}
