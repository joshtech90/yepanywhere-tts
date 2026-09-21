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
  repository: z
    .string()
    .refine(
      (value) =>
        githubRepository.test(value) ||
        (!/[\x00-\x1f]/.test(value) &&
          (isAbsolute(value) || value.startsWith("~/"))),
      "Expected a GitHub repository or an absolute local directory",
    ),
  contentPath: z
    .string()
    .refine(
      (value) =>
        value === "" ||
        (!/[\\:\x00-\x1f]/.test(value) &&
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

/** Fetching is injectable so route tests use local fixtures without network. */
export type FetchTemplateRepository = (
  config: ProjectTemplateSourceConfig,
  directory: string,
) => Promise<string>;
export type ResolveTemplateRevision = (
  config: ProjectTemplateSourceConfig,
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

async function resolveRevision(
  config: ProjectTemplateSourceConfig,
): Promise<string> {
  if (/^[0-9a-f]{40}$/.test(config.revision)) return config.revision;
  const ref = config.revision;
  const patterns =
    ref === "HEAD" || ref.startsWith("refs/")
      ? [ref, `${ref}^{}`]
      : [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`];
  const { stdout } = await execute(
    "git",
    ["ls-remote", "--exit-code", config.repository, ...patterns],
    {
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    },
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
): Promise<string> {
  const emptyConfig = join(directory, "git-config");
  await writeFile(emptyConfig, "", { mode: 0o600 });
  const checkout = join(directory, "repository");
  const hooks = join(directory, "empty-hooks");
  await mkdir(hooks, { mode: 0o700 });
  const git = async (args: string[]) =>
    execute("git", args, {
      cwd: directory,
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_TERMINAL_PROMPT: "0",
      },
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
    private readonly resolveRef: ResolveTemplateRevision = resolveRevision,
  ) {
    this.directory = join(dataDir, "project-templates-source");
  }

  private async load(): Promise<void> {
    let saved: string;
    try {
      saved = await readFile(join(this.directory, "state.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed = JSON.parse(saved) as ProjectTemplateSourceState;
    templateSourceConfig.parse(parsed.config);
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

  async current(): Promise<ProjectTemplateSourceState> {
    await (this.initialized ??= this.load());
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
    await (this.initialized ??= this.load());
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

  private async retrieve(
    config: ProjectTemplateSourcesConfig,
    previous: ProjectTemplateSourceState,
  ): Promise<void> {
    const snapshots: ProjectTemplateSourceSnapshot[] = [];
    let changed = false;
    for (const source of config.sources) {
      if (!githubRepository.test(source.repository)) {
        snapshots.push(await localSnapshot(source));
        changed = true;
        continue;
      }
      const resolved = await this.resolveRef(source);
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
    for (const template of templates) library.compose(template.id);
    this.state = {
      config,
      phase: "ready",
      result: changed || !sameOrder ? "updated" : "up-to-date",
      snapshot: { sources: snapshots, templates },
    };
    await this.persist();
  }
}
