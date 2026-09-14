import { createHash } from "node:crypto";
import { fork, execFileSync } from "node:child_process";
import { lstat, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getCodexRolloutFileIdentity,
  preferPlainCodexRollouts,
} from "../packages/server/src/utils/codexRolloutFiles.js";
import type {
  AuditFile,
  AuditFileResult,
  AuditGroup,
  AuditRequest,
} from "./tool-display-audit.js";

const help = `Read-only historical tool display audit (Codex and Claude).

pnpm tools:audit [--codex PATH] [--claude PATH] [--output REPORT.json]
                 [--locations PRIVATE.json] [--limit N] [--timeout-seconds N]
                 [--fail-on-findings]

With no roots, scans CODEX_HOME/{sessions,archived_sessions} and
CLAUDE_CONFIG_DIR/projects (defaults ~/.codex and ~/.claude).
Explicit --codex/--claude roots replace defaults; repeat to include profiles.
Roots may be directories or individual transcripts. Symlinks are not followed.
Output files must not already exist. Locations is an optional PRIVATE map of
hashed file identifiers to paths; the main report contains no payload strings.
Each file runs in a separate worker with a 120-second default timeout.
Exit 0: complete audit; 1: findings with --fail-on-findings; 2: incomplete scan
or invalid arguments. A --limit run is explicitly incomplete if files remain.
Findings are candidates, not proof of a UI regression. No media is fetched or
preserved and no providers/server/indexes are started. See topics/rich-text-rendering.md.
`;

export interface AuditOptions {
  roots: {
    provider: AuditFile["provider"];
    path: string;
    optional?: boolean;
  }[];
  output?: string;
  locations?: string;
  limit?: number;
  timeoutMs: number;
  failOnFindings: boolean;
}
function absolute(value: string): string {
  return resolve(value.replace(/^~(?=[/\\]|$)/, homedir()));
}
export function parseAuditArgs(args: string[]): AuditOptions {
  const options: AuditOptions = {
    roots: [],
    timeoutMs: 120_000,
    failOnFindings: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--fail-on-findings") {
      options.failOnFindings = true;
      continue;
    }
    if (
      ![
        "--codex",
        "--claude",
        "--output",
        "--locations",
        "--limit",
        "--timeout-seconds",
      ].includes(arg ?? "")
    )
      throw new Error("Unknown argument; use --help");
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new Error("Missing option value");
    if (arg === "--codex" || arg === "--claude")
      options.roots.push({
        provider: arg === "--codex" ? "codex" : "claude",
        path: absolute(value),
      });
    else if (arg === "--output") options.output = absolute(value);
    else if (arg === "--locations") options.locations = absolute(value);
    else {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number <= 0 || number > 2_000_000)
        throw new Error(
          "Limits must be positive integers no larger than 2000000",
        );
      if (arg === "--limit") options.limit = number;
      else options.timeoutMs = number * 1000;
    }
  }
  if (!options.roots.length) {
    const codex = process.env.CODEX_HOME || join(homedir(), ".codex");
    options.roots = [
      { provider: "codex", path: join(codex, "sessions"), optional: true },
      {
        provider: "codex",
        path: join(codex, "archived_sessions"),
        optional: true,
      },
      {
        provider: "claude",
        path: join(
          process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
          "projects",
        ),
        optional: true,
      },
    ];
  }
  if (options.output && options.output === options.locations)
    throw new Error("Report and locations must be separate files");
  return options;
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export async function discoverAuditFiles(roots: AuditOptions["roots"]) {
  const files = new Map<string, AuditFile>();
  const errors: { locationId: string; reason: string }[] = [];
  let symlinksSkipped = 0;
  let unrecognizedFiles = 0;
  let missingDefaultRoots = 0;
  async function visit(
    path: string,
    provider: AuditFile["provider"],
    optional = false,
  ) {
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        symlinksSkipped++;
        return;
      }
      if (stats.isDirectory()) {
        for (const name of (await readdir(path)).sort())
          await visit(join(path, name), provider);
      } else if (stats.isFile() && /\.jsonl(?:\.zst)?$/.test(path)) {
        if (provider === "codex" && !getCodexRolloutFileIdentity(path)) {
          unrecognizedFiles++;
          return;
        }
        if (provider === "claude" && path.endsWith(".zst")) {
          errors.push({
            locationId: hash(path),
            reason: "unsupported-claude-compression",
          });
          return;
        }
        const canonical = await realpath(path);
        const previous = files.get(canonical);
        if (previous && previous.provider !== provider)
          throw new Error("Conflicting providers");
        files.set(canonical, {
          path: canonical,
          provider,
          fileId: hash(canonical),
        });
      }
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
        missingDefaultRoots++;
      else errors.push({ locationId: hash(path), reason: "discovery-failed" });
    }
  }
  for (const root of roots)
    await visit(root.path, root.provider, root.optional);
  const selected = new Set(preferPlainCodexRollouts([...files.keys()]));
  return {
    files: [...files.values()]
      .filter((file) => selected.has(file.path))
      .sort((a, b) => a.path.localeCompare(b.path)),
    errors,
    symlinksSkipped,
    unrecognizedFiles,
    missingDefaultRoots,
    duplicateRepresentations: files.size - selected.size,
  };
}

export function runAuditWorker(
  request: AuditRequest,
  timeoutMs: number,
): Promise<AuditFileResult | { fileId: string; failure: string }> {
  return new Promise((done) => {
    const child = fork(fileURLToPath(import.meta.url), ["--worker"], {
      execArgv: [
        "--import",
        "tsx",
        "--conditions=source",
        "--max-old-space-size=2048",
      ],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        ...process.env,
        LOG_TO_FILE: "false",
        LOG_LEVEL: "silent",
        LOG_FILE_LEVEL: "silent",
      },
    });
    let result:
      | AuditFileResult
      | { fileId: string; failure: string }
      | undefined;
    const timer = setTimeout(() => {
      result = { fileId: request.file.fileId, failure: "timeout" };
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("message", (message) => {
      result = message as typeof result;
    });
    child.once("error", () => {
      clearTimeout(timer);
      done({ fileId: request.file.fileId, failure: "worker-start-failed" });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      done(
        result ?? {
          fileId: request.file.fileId,
          failure: code === 0 ? "worker-no-result" : "worker-failed",
        },
      );
    });
    child.send(request);
  });
}

async function writeNew(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

export async function runAudit(options: AuditOptions) {
  for (const path of [options.output, options.locations]) {
    if (!path) continue;
    try {
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Output already exists");
  }
  const discovered = await discoverAuditFiles(options.roots);
  const rolloutPaths: Record<string, string> = {};
  for (const file of discovered.files) {
    const identity =
      file.provider === "codex" ? getCodexRolloutFileIdentity(file.path) : null;
    if (identity) rolloutPaths[identity.rolloutId] = file.path;
  }
  const selected = discovered.files.slice(0, options.limit);
  const groups = new Map<string, AuditGroup>();
  const files: Omit<AuditFileResult, "groups">[] = [];
  const failures: { fileId: string; failure: string }[] = [];
  const counts: Record<string, number> = {};
  for (const [index, file] of selected.entries()) {
    process.stderr.write(
      `Audit ${index + 1}/${selected.length} ${file.provider} ${file.fileId}\n`,
    );
    const result = await runAuditWorker(
      { file, rolloutPaths },
      options.timeoutMs,
    );
    if ("failure" in result) {
      failures.push(result);
      continue;
    }
    const { groups: fileGroups, ...summary } = result;
    files.push(summary);
    for (const [key, value] of Object.entries(result.counts))
      counts[key] = (counts[key] ?? 0) + value;
    for (const group of fileGroups) {
      const key = JSON.stringify([
        group.provider,
        group.version,
        group.tool,
        group.category,
        group.reason,
        group.inputShape,
        group.resultShape,
        group.issues,
      ]);
      const current = groups.get(key);
      if (current) {
        current.count += group.count;
        current.examples = [...current.examples, ...group.examples].slice(0, 3);
      } else groups.set(key, group);
    }
  }
  let revision = "unknown";
  let workingTreeDirty: boolean | null = null;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    workingTreeDirty =
      execFileSync("git", ["status", "--porcelain"], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0;
  } catch {
    /* Source archives need no Git checkout. */
  }
  const incomplete =
    selected.length < discovered.files.length ||
    !files.length ||
    failures.length > 0 ||
    discovered.errors.length > 0 ||
    discovered.symlinksSkipped > 0 ||
    discovered.unrecognizedFiles > 0 ||
    files.some((file) => file.malformedLines > 0 || file.changedDuringRead);
  const report = {
    formatVersion: 1,
    revision,
    workingTreeDirty,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    scope:
      "Full selected transcript files through production parsing, normalization, persisted augments, and final tool-row compilation. Current Claude branch; Codex inherited prefixes count per leaf. No browser, commentary, media materialization, live-only events, or universal field-loss validation.",
    complete: !incomplete,
    discoveredFiles: discovered.files.length,
    selectedFiles: selected.length,
    duplicateRepresentations: discovered.duplicateRepresentations,
    missingDefaultRoots: discovered.missingDefaultRoots,
    symlinksSkipped: discovered.symlinksSkipped,
    unrecognizedFiles: discovered.unrecognizedFiles,
    discoveryErrors: discovered.errors,
    counts,
    failures,
    files,
    groups: [...groups.values()].sort(
      (a, b) =>
        b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
  };
  if (options.output) await writeNew(options.output, report);
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (options.locations)
    await writeNew(
      options.locations,
      Object.fromEntries(selected.map((file) => [file.fileId, file.path])),
    );
  process.stderr.write(
    `Audited ${files.length}/${selected.length} files; ${counts["successful-raw"] ?? 0} successful raw rows, ${counts["error-raw"] ?? 0} error raw rows. Complete: ${!incomplete}.\n`,
  );
  return incomplete
    ? 2
    : options.failOnFindings &&
        ((counts["successful-raw"] ?? 0) > 0 ||
          (counts["projection-loss"] ?? 0) > 0)
      ? 1
      : 0;
}

async function main() {
  if (process.argv[2] === "--worker") {
    process.once("disconnect", () => process.exit(2));
    process.once("message", async (request: AuditRequest) => {
      let warnings = 0;
      console.warn = () => {
        warnings++;
      };
      console.error = () => {
        warnings++;
      };
      try {
        if (request.file.path.endsWith(".zst")) {
          const { isZstdJsonlSupported } = await import(
            "../packages/server/src/utils/jsonl.js"
          );
          if (!isZstdJsonlSupported()) {
            process.send?.(
              {
                fileId: request.file.fileId,
                failure: "unsupported-zstd-runtime",
              },
              () => process.exit(0),
            );
            return;
          }
        }
        const { auditTranscript } = await import("./tool-display-audit.js");
        const result = await auditTranscript(request);
        result.warnings = warnings;
        process.send?.(result, () => process.exit(0));
      } catch (error) {
        const failure =
          error instanceof Error && error.name === "CodexRolloutLineageError"
            ? "invalid-or-missing-lineage"
            : "read-or-projection-failed";
        process.send?.({ fileId: request.file.fileId, failure }, () =>
          process.exit(0),
        );
      }
    });
    return;
  }
  if (process.argv.includes("--help")) {
    process.stdout.write(help);
    return;
  }
  try {
    process.exitCode = await runAudit(parseAuditArgs(process.argv.slice(2)));
  } catch {
    process.stderr.write(
      "Audit could not finish. Check arguments, readable roots, and new writable output paths; use --help.\n",
    );
    process.exitCode = 2;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main();
