import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
  DEFAULT_PROJECT_TEMPLATE_SOURCES,
  type ProjectTemplateSourceConfig,
  type ProjectTemplateSourcesConfig,
  type ProjectTemplateSourceSnapshot,
  type ProjectTemplateSourceState,
} from "@yep-anywhere/shared";
import { z } from "zod";
import { TemplateLibrary } from "./template-library.js";

const execute = promisify(execFile);
const githubRepository =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const sourceEntry = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  repository: z.string().refine(
    (value) =>
      githubRepository.test(value) ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Local paths must reject ASCII control bytes.
      (!/[\x00-\x1f]/.test(value) && // oxlint-disable-line no-control-regex -- Reject ASCII control bytes.
        (isAbsolute(value) || value.startsWith("~/"))),
    "Expected a GitHub repository or an absolute local directory",
  ),
  contentPath: z.string().refine(
    (value) =>
      value === "" ||
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Content paths must reject ASCII control bytes.
      (!/[\\:\x00-\x1f]/.test(value) && // oxlint-disable-line no-control-regex -- Reject ASCII control bytes.
        value
          .split("/")
          .every(
            (part) => !["", ".", "..", ".git"].includes(part.toLowerCase()),
          )),
  ),
  revision: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
});
export const templateSourceConfig = z.strictObject({
  enabled: z.boolean(),
  sources: z
    .array(sourceEntry)
    .min(1)
    .max(20)
    .refine(
      (sources) =>
        new Set(sources.map((source) => source.id)).size === sources.length,
      "Source IDs must be unique",
    ),
});

/** The saved `state.json`, validated whole because retrieval reuses its snapshot. */
const savedTemplateSourceState = z.object({
  config: templateSourceConfig,
  phase: z.enum(["disabled", "fetching", "ready", "error"]),
  error: z.string().optional(),
  result: z.enum(["updated", "up-to-date"]).optional(),
  snapshot: z
    .object({
      sources: z.array(
        z.object({
          id: z.string(),
          repository: z.string(),
          contentPath: z.string(),
          revision: z.string(),
          commit: z.string().nullable(),
          local: z.boolean().optional(),
          rawDirectory: z.string(),
          directory: z.string(),
          rewrittenFiles: z.number(),
        }),
      ),
      templates: z.array(
        z.object({
          id: z.string(),
          sourceId: z.string(),
          title: z.string(),
          description: z.string(),
          status: z.enum(["draft", "ready"]),
        }),
      ),
    })
    .optional(),
});

/**
 * Runs git for a GitHub template source. The ref check and the download share
 * one runner so they reach the remote the same way.
 */
export type TemplateSourceGit = (
  args: string[],
  options: { cwd?: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

/**
 * Git with the host's system and global Git config ignored: a user's URL
 * rewrites, credential helpers, proxy and CA settings apply to neither call.
 * `emptyConfig` names an empty file standing in for the global config.
 */
export function isolatedTemplateSourceGit(
  emptyConfig: string,
): TemplateSourceGit {
  return (args, options) =>
    execute("git", args, {
      ...options,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_TERMINAL_PROMPT: "0",
      },
    });
}

/** Fetching is injectable so route tests use local fixtures without network. */
export type FetchTemplateRepository = (
  config: ProjectTemplateSourceConfig,
  directory: string,
  git: TemplateSourceGit,
) => Promise<string>;
export type ResolveTemplateRevision = (
  config: ProjectTemplateSourceConfig,
  git: TemplateSourceGit,
) => Promise<string>;

export class TemplateSourceBusyError extends Error {
  constructor() {
    super("Template retrieval is already in progress");
    this.name = "TemplateSourceBusyError";
  }
}

async function localSnapshot(
  source: ProjectTemplateSourceConfig,
): Promise<ProjectTemplateSourceSnapshot> {
  const expanded = source.repository.startsWith("~/")
    ? join(homedir(), source.repository.slice(2))
    : source.repository;
  const content = await realpath(join(expanded, source.contentPath));
  if (!(await lstat(content)).isDirectory())
    throw new Error("Local template source is not a directory");
  let repository = content;
  let commit: string | null = null;
  const git = (args: string[]) =>
    execute("git", ["-C", content, ...args], {
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
    });
  try {
    repository = await realpath(
      (await git(["rev-parse", "--show-toplevel"])).stdout.trim(),
    );
    try {
      commit = (
        await git(["rev-parse", "--verify", "--quiet", "HEAD"])
      ).stdout.trim();
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error;
    }
  } catch (error) {
    if (
      !(error as { stderr?: string }).stderr?.includes("not a git repository")
    )
      throw error;
  }
  return {
    ...source,
    local: true,
    commit,
    rawDirectory: repository,
    directory: repository,
    contentPath: relative(repository, content).split(sep).join("/"),
    rewrittenFiles: 0,
  };
}

/** Resolves a GitHub source's branch, tag or HEAD to the commit ls-remote reports. */
export async function resolveTemplateRevision(
  config: ProjectTemplateSourceConfig,
  git: TemplateSourceGit,
): Promise<string> {
  if (/^[0-9a-f]{40}$/.test(config.revision)) return config.revision;
  const ref = config.revision;
  const patterns =
    ref === "HEAD" || ref.startsWith("refs/")
      ? [ref, `${ref}^{}`]
      : [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`];
  const { stdout } = await git(
    ["ls-remote", "--exit-code", config.repository, ...patterns],
    { timeout: 30_000, maxBuffer: 64 * 1024 },
  );
  const refs = new Map(
    stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [sha = "", name = ""] = line.split("\t");
        return [name, sha];
      }),
  );
  if (refs.has(`refs/heads/${ref}`) && refs.has(`refs/tags/${ref}`))
    throw new Error("Ambiguous revision: use refs/heads/ or refs/tags/");
  const sha =
    [...refs].find(([name]) => name.endsWith("^{}"))?.[1] ??
    [...refs.values()][0];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha))
    throw new Error("Revision does not resolve to a commit");
  return sha;
}

async function fetchRepository(
  config: ProjectTemplateSourceConfig,
  directory: string,
  runGit: TemplateSourceGit,
): Promise<string> {
  const checkout = join(directory, "repository");
  const hooks = join(directory, "empty-hooks");
  await mkdir(hooks, { mode: 0o700 });
  const git = (args: string[]) =>
    runGit(args, {
      cwd: directory,
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  await git(["init", checkout]);
  await git(["-C", checkout, "remote", "add", "origin", config.repository]);
  await git([
    "-C",
    checkout,
    "-c",
    "protocol.file.allow=never",
    "fetch",
    "--depth=1",
    "origin",
    config.revision,
  ]);
  await git([
    "-C",
    checkout,
    "-c",
    `core.hooksPath=${hooks}`,
    "checkout",
    "--detach",
    "FETCH_HEAD",
  ]);
  const { stdout } = await git(["-C", checkout, "rev-parse", "HEAD"]);
  return stdout.trim();
}

/**
 * Relocate explicit ~/repository-name references in text, never binary bytes or
 * symlink targets. Relative source links continue to use the cloned repository.
 * This private snapshot is for source consumption; project export must relocate
 * source references again to the project's vendored destinations.
 */
export async function relocateTemplateReferences(
  root: string,
  repository: string,
  dependencies: { repository: string; directory: string }[] = [
    { repository, directory: root },
  ],
): Promise<number> {
  const aliases = new Map(
    dependencies.map((source) => {
      const name = githubRepository.test(source.repository)
        ? source.repository
            .split("/")
            .at(-1)
            ?.replace(/\.git$/, "")
        : basename(source.directory);
      if (!name) throw new Error("Missing repository name");
      return [`~/${name}`, resolve(source.directory).replaceAll("\\", "/")];
    }),
  );
  let rewritten = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = await readFile(path);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      if (!Buffer.from(text).equals(bytes)) continue;
      let translated = text;
      for (const [alias, target] of aliases) {
        if (!translated.includes(alias)) continue;
        // Require path/token boundaries: ~/agents-other is not this repository.
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(
          String.raw`(^|[\s\x60"'(=<>])${escaped}(?=/|$|[\s\x60"')<>.,;:])`,
          "gm",
        );
        translated = translated.replace(
          pattern,
          (_match, prefix: string) =>
            `${prefix}${path.endsWith(".json") ? JSON.stringify(target).slice(1, -1) : target}`,
        );
      }
      if (translated !== text) {
        await writeFile(path, translated);
        rewritten++;
      }
    }
  };
  await visit(root);
  return rewritten;
}

export class TemplateSourceService {
  private state: ProjectTemplateSourceState = {
    config: structuredClone(DEFAULT_PROJECT_TEMPLATE_SOURCES),
    phase: "disabled",
  };
  private readonly directory: string;
  private initialized?: Promise<void>;
  private saving = false;
  private retrieving = false;
  private operation: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly fetch: FetchTemplateRepository = fetchRepository,
    private readonly resolveRef: ResolveTemplateRevision = resolveTemplateRevision,
  ) {
    this.directory = join(dataDir, "project-templates-source");
  }

  private async load(): Promise<void> {
    const file = join(this.directory, "state.json");
    let parsed: ProjectTemplateSourceState;
    try {
      parsed = savedTemplateSourceState.parse(
        JSON.parse(await readFile(file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      await this.setAsideUnreadableState(file, error);
      return;
    }
    this.state = parsed;
    if (this.state.phase === "fetching") {
      this.state = {
        config: parsed.config,
        phase: "error",
        ...(parsed.snapshot ? { snapshot: parsed.snapshot } : {}),
        error: "Retrieval was interrupted. Fetch again to retry.",
      };
    }
  }

  /**
   * Moves an unreadable saved state out of the way and starts from the defaults
   * in an explained error state, so a Save can replace it without a hand edit.
   */
  private async setAsideUnreadableState(
    file: string,
    cause: unknown,
  ): Promise<void> {
    const aside = `state.unreadable-${new Date().toISOString().replaceAll(":", "-")}.json`;
    let error = `Saved template source settings could not be read and were set aside as ${aside}. Save to replace them with the settings shown.`;
    let movedAside = true;
    try {
      await rename(file, join(this.directory, aside));
      console.error(
        `[TemplateSource] Unreadable saved state set aside as ${aside}:`,
        cause,
      );
    } catch (renameError) {
      movedAside = false;
      error =
        "Saved template source settings could not be read. Save to replace them with the settings shown.";
      console.error(
        "[TemplateSource] Unreadable saved state could not be set aside:",
        cause,
        renameError,
      );
    }
    this.state = {
      config: structuredClone(DEFAULT_PROJECT_TEMPLATE_SOURCES),
      phase: "error",
      error,
    };
    // Keep the explanation across a restart, but never write over the only copy.
    if (!movedAside) return;
    try {
      await this.persist();
    } catch (persistError) {
      console.error(
        "[TemplateSource] Cannot persist the unreadable-state notice:",
        persistError,
      );
    }
  }

  async current(): Promise<ProjectTemplateSourceState> {
    this.initialized ??= this.load();
    await this.initialized;
    return structuredClone(this.state);
  }

  private async persist(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `state-${randomUUID()}.json`);
    await writeFile(temporary, JSON.stringify(this.state, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, join(this.directory, "state.json"));
  }

  async configure(input: unknown): Promise<ProjectTemplateSourceState> {
    const config = templateSourceConfig.parse(input);
    this.initialized ??= this.load();
    await this.initialized;
    if (this.saving || this.retrieving) throw new TemplateSourceBusyError();
    this.saving = true;
    const previous = this.state;
    try {
      this.state = {
        config,
        phase: config.enabled ? "fetching" : "disabled",
        ...(previous.snapshot ? { snapshot: previous.snapshot } : {}),
      };
      await this.persist();
    } catch (error) {
      this.state = previous;
      throw error;
    } finally {
      this.saving = false;
    }
    if (config.enabled) {
      this.retrieving = true;
      this.operation = this.retrieve(config, previous)
        .catch(async (error: unknown) => {
          this.state = {
            config,
            phase: "error",
            ...(previous.snapshot ? { snapshot: previous.snapshot } : {}),
            error: error instanceof Error ? error.message : String(error),
          };
          await this.persist();
        })
        .finally(() => {
          this.retrieving = false;
        });
      // Preserve an observable error even if persisting the failure also fails.
      void this.operation.catch((error: unknown) =>
        console.error(
          "[TemplateSource] Cannot persist retrieval result",
          error,
        ),
      );
    }
    return this.current();
  }

  async waitForRetrieval(): Promise<void> {
    await this.operation;
  }

  /** Revalidates mutable sources and loads the admitted revisions for creation. */
  async creationLibrary(): Promise<TemplateLibrary> {
    const state = await this.current();
    if (!state.config.enabled || state.phase !== "ready" || !state.snapshot)
      throw new Error(
        "Project template sources are not ready; check Settings → Project templates",
      );
    const admitted = this.state;
    const library = await TemplateLibrary.loadSources(
      state.snapshot.sources.map((source) => ({
        id: source.id,
        repository: source.directory,
        contentPath: source.contentPath,
      })),
    );
    if (this.state !== admitted)
      throw new Error(
        "Project template sources changed during validation; retry creation",
      );
    return library;
  }

  private async retrieve(
    config: ProjectTemplateSourcesConfig,
    previous: ProjectTemplateSourceState,
  ): Promise<void> {
    const snapshots: ProjectTemplateSourceSnapshot[] = [];
    // Set when a GitHub copy or a relocation target differs from the admitted
    // snapshot; local working files are re-read below either way.
    let changed = false;
    const emptyGitConfig = join(this.directory, "git-config");
    await writeFile(emptyGitConfig, "", { mode: 0o600 });
    const git = isolatedTemplateSourceGit(emptyGitConfig);
    for (const source of config.sources) {
      if (!githubRepository.test(source.repository)) {
        const snapshot = await localSnapshot(source);
        snapshots.push(snapshot);
        // Relocation aliases a local source by its directory, never its files.
        const admitted = previous.snapshot?.sources.find(
          (item) => item.id === source.id,
        );
        if (!admitted?.local || admitted.directory !== snapshot.directory)
          changed = true;
        continue;
      }
      const resolved = await this.resolveRef(source, git);
      const cached = previous.snapshot?.sources.find(
        (item) =>
          item.id === source.id &&
          item.repository === source.repository &&
          item.contentPath === source.contentPath &&
          item.commit === resolved,
      );
      if (cached) {
        snapshots.push({ ...cached, ...source });
        continue;
      }
      changed = true;
      const directory = join(this.directory, randomUUID());
      await mkdir(directory, { mode: 0o700 });
      const commit = await this.fetch(
        { ...source, revision: resolved },
        directory,
        git,
      );
      if (commit !== resolved || !/^[0-9a-f]{40,64}$/.test(commit))
        throw new Error("Fetched revision differs from the resolved commit");
      const repository = join(directory, "repository");
      if (!(await lstat(repository)).isDirectory())
        throw new Error("Missing source checkout");
      snapshots.push({
        ...source,
        commit,
        rawDirectory: repository,
        directory: repository,
        rewrittenFiles: 0,
      });
    }
    const inputs = () =>
      snapshots.map((source) => ({
        id: source.id,
        repository: source.directory,
        contentPath: source.contentPath,
      }));
    const sameOrder =
      previous.snapshot?.sources.map((source) => source.id).join("\0") ===
      snapshots.map((source) => source.id).join("\0");
    if (changed || !sameOrder) {
      const layerRoot = join(this.directory, randomUUID(), "content");
      await mkdir(layerRoot, { recursive: true, mode: 0o700 });
      for (const source of snapshots) {
        if (source.local) continue;
        source.directory = join(layerRoot, source.id);
        await cp(source.rawDirectory, source.directory, {
          recursive: true,
          verbatimSymlinks: true,
          filter: (path) => path.split(/[\\/]/).at(-1) !== ".git",
        });
      }
      await TemplateLibrary.loadSources(inputs());
      for (const source of snapshots) {
        if (source.local) continue;
        source.rewrittenFiles = await relocateTemplateReferences(
          source.directory,
          source.repository,
          snapshots,
        );
      }
    }
    const library = await TemplateLibrary.loadSources(inputs());
    const templates = library
      .list()
      .map(({ id, title, description, status }) => ({
        id,
        sourceId: library.sourceOf(id),
        title,
        description,
        status,
      }));
    this.state = {
      config,
      phase: "ready",
      result: changed || !sameOrder ? "updated" : "up-to-date",
      snapshot: { sources: snapshots, templates },
    };
    await this.persist();
  }
}
