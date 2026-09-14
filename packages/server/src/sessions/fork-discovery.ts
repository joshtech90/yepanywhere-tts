import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ProviderName } from "@yep-anywhere/shared";

// A bounded path cache bridges fork completion and ordinary file discovery.
// It is shared by readers (including newly created/sandbox readers), and scan
// completions never replace it. Hints are not authoritative: readers still
// validate the file and its provider/project metadata before using it.
const forkPaths = new Map<string, string>();
const MAX_FORK_PATHS = 1024;

export function registerForkedSessionFile(
  provider: ProviderName,
  sessionId: string,
  filePath: string | undefined,
): void {
  if (!filePath || !isAbsolute(filePath)) return;
  if (provider !== "codex" && provider !== "pi") return;
  const key = `${provider}\0${sessionId}`;
  forkPaths.delete(key);
  forkPaths.set(key, resolve(filePath));
  while (forkPaths.size > MAX_FORK_PATHS) {
    const oldest = forkPaths.keys().next().value;
    if (oldest === undefined) break;
    forkPaths.delete(oldest);
  }
}

export async function getForkedSessionFile(
  provider: "codex" | "pi",
  sessionId: string,
  sessionsDir: string,
): Promise<string | undefined> {
  const filePath = forkPaths.get(`${provider}\0${sessionId}`);
  if (!filePath) return undefined;
  // Resolve aliases (e.g. macOS /var) and reject symlinks outside this store.
  let canonicalFile: string;
  let canonicalRoot: string;
  try {
    [canonicalFile, canonicalRoot] = await Promise.all([
      realpath(filePath),
      realpath(sessionsDir),
    ]);
  } catch {
    return undefined;
  }
  const pathWithinRoot = relative(canonicalRoot, canonicalFile);
  if (
    !pathWithinRoot ||
    pathWithinRoot === ".." ||
    pathWithinRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathWithinRoot)
  ) {
    return undefined;
  }
  return filePath;
}
