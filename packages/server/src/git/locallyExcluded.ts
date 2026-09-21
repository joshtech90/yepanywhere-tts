import { compareWorktreePaths } from "../projects/projectWorktreeCoverage.js";
import { GIT_DECODE_PATHS_ARGS, runGit } from "./gitExec.js";

const LOCAL_EXCLUDE_SOURCE_SUFFIX = "info/exclude";
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Files Git ignores because of this clone's private `.git/info/exclude`.
 *
 * Source Control splits the two kinds of ignored content by where the rule
 * lives. A `.gitignore` rule is shared project truth about build output and
 * dependencies, and stays out of the browser entirely. A `.git/info/exclude`
 * rule is this clone's own decision to keep authored material — private
 * notes, review files, task state — out of commits, so that material stays
 * browsable here. Making a directory browsable is therefore a Git operation
 * the user already knows: move its rule from `.gitignore` to
 * `.git/info/exclude`.
 */
export async function listLocallyExcludedPaths(
  cwd: string,
  options: { maxBuffer?: number } = {},
): Promise<string[]> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const entries = await listIgnoredEntries(cwd, maxBuffer);
  if (entries.length === 0) return [];

  const locallyExcluded = await filterLocallyExcluded(cwd, entries, maxBuffer);
  if (locallyExcluded.length === 0) return [];

  const directories = locallyExcluded.filter((entry) => entry.endsWith("/"));
  const files = locallyExcluded.filter((entry) => !entry.endsWith("/"));
  if (directories.length === 0) return files.sort(compareWorktreePaths);

  const expanded = splitNullPaths(
    (
      await runGit(
        cwd,
        [
          ...GIT_DECODE_PATHS_ARGS,
          "ls-files",
          "-z",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--",
          ...directories,
        ],
        { maxBuffer },
      )
    ).stdout,
  );
  return [...new Set([...files, ...expanded])].sort(compareWorktreePaths);
}

/** Ignored paths with whole ignored directories collapsed to one entry. */
async function listIgnoredEntries(
  cwd: string,
  maxBuffer: number,
): Promise<string[]> {
  const { stdout } = await runGit(
    cwd,
    [
      ...GIT_DECODE_PATHS_ARGS,
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
    ],
    { maxBuffer },
  );
  return splitNullPaths(stdout);
}

/**
 * Keep the entries whose winning ignore rule lives in `.git/info/exclude`.
 * `check-ignore -v -z` reports the rule that decided each path as
 * `source\0line\0pattern\0path\0`, so a path listed in both files is
 * classified by the rule Git actually applied.
 */
async function filterLocallyExcluded(
  cwd: string,
  entries: readonly string[],
  maxBuffer: number,
): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await runGit(
      cwd,
      [...GIT_DECODE_PATHS_ARGS, "check-ignore", "-z", "-v", "--stdin"],
      { maxBuffer, input: `${entries.join("\0")}\0` },
    ));
  } catch (error) {
    // Exit 1 is check-ignore's "no path matched", not a failure.
    if (isExitCode(error, 1)) return [];
    throw error;
  }

  const fields = splitNullPaths(stdout);
  const locallyExcluded: string[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const source = fields[index];
    const path = fields[index + 3];
    if (source === undefined || path === undefined) break;
    if (source.endsWith(LOCAL_EXCLUDE_SOURCE_SUFFIX))
      locallyExcluded.push(path);
  }
  return locallyExcluded;
}

function splitNullPaths(stdout: string): string[] {
  const parts = stdout.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function isExitCode(error: unknown, code: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}
