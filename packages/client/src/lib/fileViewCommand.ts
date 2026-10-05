import type { FileViewSearchResult } from "@yep-anywhere/shared";

/** The `/v` or `/view` draft's argument and where it starts. */
export interface FileViewDraft {
  command: string;
  argument: string;
  argumentStart: number;
}

/**
 * Read a composer draft as a `/v` command. Only a single-line draft whose
 * command token is followed by whitespace qualifies, so typing `/view`
 * itself still completes the command name.
 */
export function readFileViewDraft(text: string): FileViewDraft | null {
  const match = /^\/(v|view)[ \t]+([^\n]*)$/i.exec(text);
  if (!match?.[1]) return null;
  const argument = match[2] ?? "";
  return {
    command: match[1].toLowerCase(),
    argument,
    argumentStart: text.length - argument.length,
  };
}

/** Recent project paths for ranking, bounded like path completion's. */
function appendRecent(params: URLSearchParams, recent: readonly string[]) {
  let bytes = 0;
  for (const path of recent) {
    const cost = encodeURIComponent(path).length + 8;
    if (bytes + cost > 4096) continue;
    params.append("recent", path);
    bytes += cost;
  }
}

export function fileViewSearchPath(
  projectId: string,
  parts: readonly string[],
  options: { recent?: readonly string[]; includeIgnored?: boolean } = {},
): string {
  const params = new URLSearchParams();
  for (const part of parts) params.append("part", part);
  appendRecent(params, options.recent ?? []);
  if (options.includeIgnored) params.set("ignored", "1");
  return `/projects/${projectId}/file-view-search?${params}`;
}

export type FileViewFetch = (
  path: string,
  init?: { signal?: AbortSignal },
) => Promise<FileViewSearchResult>;

/**
 * Resolve a submitted `/v` for opening: search including ignored files, and
 * wait while the untracked inventory is still filling so the first answer is
 * not a tracked-only guess. Gives up waiting after `maxWaitMs` and returns
 * what it has.
 */
export async function resolveFileViewSubmission(
  fetch: FileViewFetch,
  projectId: string,
  parts: readonly string[],
  recent: readonly string[],
  maxWaitMs = 10_000,
): Promise<FileViewSearchResult> {
  const path = fileViewSearchPath(projectId, parts, {
    recent,
    includeIgnored: true,
  });
  const deadline = Date.now() + maxWaitMs;
  let result = await fetch(path);
  while (result.pending && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    result = await fetch(path);
  }
  return result;
}
