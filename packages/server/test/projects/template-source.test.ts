import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import {
  DEFAULT_PROJECT_TEMPLATE_SOURCE,
  type ProjectTemplateSourceConfig,
} from "@yep-anywhere/shared";
import {
  TemplateSourceService,
  relocateTemplateReferences,
  templateSourceConfig,
} from "../../src/projects/TemplateSourceService.js";
import { createProjectTemplateSourceRoutes } from "../../src/routes/project-template-source.js";
import { TemplateLibrary } from "../../src/projects/template-library.js";

describe("template source retrieval", () => {
  let root: string;
  const sha = "a".repeat(40);
  const source = DEFAULT_PROJECT_TEMPLATE_SOURCE;
  const config = { sources: [{ ...source }], enabled: true };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ya-template-source-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true });
  });

  async function fixture(directory: string, contentPath: string) {
    const repository = join(directory, "repository");
    const content = join(repository, contentPath);
    await mkdir(join(content, "templates", "app"), { recursive: true });
    await mkdir(join(repository, "topics"), { recursive: true });
    await writeFile(join(repository, "topics", "guide.md"), "# Guide");
    await writeFile(
      join(content, "library.json"),
      JSON.stringify({ formatVersion: 1, bases: [], templates: ["app"] }),
    );
    await writeFile(
      join(content, "templates", "app", "instructions.md"),
      "Read `~/agents/topics/guide.md`. Leave ~/agents-other alone.\n",
    );
    await writeFile(
      join(content, "templates", "app", "template.json"),
      JSON.stringify({
        formatVersion: 1,
        kind: "template",
        status: "draft",
        id: "app",
        title: "App",
        description: "Starter",
        extends: [],
        files: [{ from: "instructions.md", to: "AGENTS.md" }],
        overrides: [],
      }),
    );
    return sha;
  }

  it("saves disabled origins without retrieval, then pins, relocates and inventories on enable", async () => {
    const fetch = vi.fn(
      async (source: ProjectTemplateSourceConfig, directory: string) => {
        expect(source.revision).toBe(sha);
        return fixture(directory, source.contentPath);
      },
    );
    const resolve = vi.fn(async () => sha);
    const service = new TemplateSourceService(root, fetch, resolve);
    const app = createProjectTemplateSourceRoutes(root, service);
    const put = (body: unknown) =>
      app.request("/project-template-source", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await service.current()).config.enabled).toBe(false);
    expect((await put({ ...config, enabled: false })).status).toBe(202);
    expect(fetch).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect((await put(config)).status).toBe(202);
    await service.waitForRetrieval();
    const state = await (await app.request("/project-template-source")).json();
    expect(state.phase).toBe("ready");
    expect(state.snapshot.sources[0].commit).toBe(sha);
    expect(state.snapshot.sources[0].rewrittenFiles).toBe(1);
    expect(state.snapshot.templates[0].status).toBe("draft");
    const instructions = await readFile(
      join(
        state.snapshot.sources[0].directory,
        source.contentPath,
        "templates/app/instructions.md",
      ),
      "utf8",
    );
    expect(instructions).toContain(
      `${state.snapshot.sources[0].directory}/topics/guide.md`,
    );
    expect(instructions).toContain("~/agents-other");
    expect(await new TemplateSourceService(root).current()).toEqual(state);
    await put(config);
    await service.waitForRetrieval();
    expect((await service.current()).result).toBe("up-to-date");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("accepts the repository root and fetches a changed origin even at the same SHA", async () => {
    const fetch = vi.fn(
      async (source: ProjectTemplateSourceConfig, directory: string) =>
        fixture(directory, source.contentPath),
    );
    const service = new TemplateSourceService(root, fetch, async () => sha);
    await service.configure({
      ...config,
      sources: [{ ...source, contentPath: "" }],
    });
    await service.waitForRetrieval();
    expect((await service.current()).phase).toBe("ready");
    await service.configure({
      ...config,
      sources: [
        {
          ...source,
          repository: "https://github.com/example/agents",
          contentPath: "",
        },
      ],
    });
    await service.waitForRetrieval();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a failed fetch and an interrupted operation without admitting a snapshot", async () => {
    const service = new TemplateSourceService(
      root,
      async () => {
        throw new Error("offline");
      },
      async () => sha,
    );
    await service.configure(config);
    await service.waitForRetrieval();
    expect(await service.current()).toMatchObject({
      phase: "error",
      error: "offline",
    });
    expect((await service.current()).snapshot).toBeUndefined();
    await writeFile(
      join(root, "project-templates-source/state.json"),
      JSON.stringify({ config, phase: "fetching" }),
    );
    expect(await new TemplateSourceService(root).current()).toMatchObject({
      phase: "error",
      error: expect.stringContaining("interrupted"),
    });
  });

  it("layers sources last-wins, resolves shared bases and relocates cached dependents after an update", async () => {
    let primarySha = sha;
    const community = {
      ...source,
      id: "community",
      repository: "https://github.com/example/community",
    };
    const fetch = vi.fn(
      async (entry: ProjectTemplateSourceConfig, directory: string) => {
        await fixture(directory, entry.contentPath);
        const content = join(directory, "repository", entry.contentPath);
        if (entry.id === source.id) {
          await mkdir(join(content, "bases", "shared"), { recursive: true });
          await writeFile(
            join(content, "library.json"),
            JSON.stringify({
              formatVersion: 1,
              bases: ["shared"],
              templates: ["app"],
            }),
          );
          await writeFile(
            join(content, "bases/shared/template.json"),
            JSON.stringify({
              formatVersion: 1,
              kind: "base",
              status: "ready",
              id: "shared",
              title: "Shared",
              description: "Shared base",
              extends: [],
              files: [],
              overrides: [],
            }),
          );
        } else {
          const path = join(content, "templates/app/template.json");
          const manifest = JSON.parse(await readFile(path, "utf8"));
          manifest.extends = ["shared"];
          manifest.title = "Community app";
          await writeFile(path, JSON.stringify(manifest));
        }
        return entry.revision;
      },
    );
    const service = new TemplateSourceService(root, fetch, async (entry) =>
      entry.id === source.id ? primarySha : sha,
    );
    const layered = { enabled: true, sources: [source, community] };
    await service.configure(layered);
    await service.waitForRetrieval();
    const first = await service.current();
    expect(first.phase).toBe("ready");
    expect(first.snapshot?.templates).toMatchObject([
      { title: "Community app", sourceId: "community" },
    ]);
    primarySha = "b".repeat(40);
    await service.configure(layered);
    await service.waitForRetrieval();
    const updated = await service.current();
    const [primary, extra] = updated.snapshot?.sources ?? [];
    if (!primary || !extra) throw new Error(updated.error ?? "Missing sources");
    expect(fetch).toHaveBeenCalledTimes(3);
    const text = await readFile(
      join(extra.directory, extra.contentPath, "templates/app/instructions.md"),
      "utf8",
    );
    expect(text).toContain(`${primary.directory}/topics/guide.md`);
    expect(text).not.toContain(first.snapshot?.sources[0]?.directory);
    const library = await TemplateLibrary.loadSources(
      updated.snapshot?.sources.map((item) => ({
        id: item.id,
        repository: item.directory,
        contentPath: item.contentPath,
      })) ?? [],
    );
    expect(library.compose("app").order).toEqual(["shared", "app"]);
    await service.configure({ ...layered, sources: [community, source] });
    await service.waitForRetrieval();
    expect((await service.current()).snapshot?.templates[0]?.sourceId).toBe(
      source.id,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects malformed requests and concurrent retrieval without replacing configuration", async () => {
    let release!: () => void;
    const pending = new Promise<void>((done) => {
      release = done;
    });
    const service = new TemplateSourceService(
      root,
      async (entry, directory) => {
        await pending;
        return fixture(directory, entry.contentPath);
      },
      async () => sha,
    );
    const app = createProjectTemplateSourceRoutes(root, service);
    const put = (body: string) =>
      app.request("/project-template-source", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      });
    expect((await put("{")).status).toBe(400);
    expect((await put(JSON.stringify(config))).status).toBe(202);
    try {
      expect(
        (await put(JSON.stringify({ ...config, enabled: false }))).status,
      ).toBe(409);
      expect((await service.current()).config.enabled).toBe(true);
    } finally {
      release();
      await service.waitForRetrieval();
    }
  });

  it("denies limited users before reading or changing source state", async () => {
    const service = new TemplateSourceService(root);
    const current = vi.spyOn(service, "current");
    const app = new Hono<{
      Variables: Record<typeof PRINCIPAL_VARIABLE, Principal>;
    }>();
    app.use("*", async (c, next) => {
      c.set(PRINCIPAL_VARIABLE, {
        kind: "limited",
        username: "reader",
        switched: false,
        locked: true,
        via: "direct",
        grants: {
          newSessionProjects: [],
          joinProjects: [],
          viewProjects: [],
          joinStaleOffsetMinutes: 0,
          lock: {},
        },
      });
      await next();
    });
    app.route("/api", createProjectTemplateSourceRoutes(root, service));
    for (const method of ["GET", "PUT"]) {
      expect(
        (await app.request("/api/project-template-source", { method })).status,
      ).toBe(403);
    }
    expect(current).not.toHaveBeenCalled();
  });

  it("uses a non-Git local directory directly and layers it over a GitHub source", async () => {
    const localRoot = join(root, "local");
    await fixture(localRoot, "");
    const localDirectory = await realpath(join(localRoot, "repository"));
    const path = join(localDirectory, "templates/app/template.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.title = "Local overlay";
    await writeFile(path, JSON.stringify(manifest));
    const fetch = vi.fn(
      async (entry: ProjectTemplateSourceConfig, directory: string) =>
        fixture(directory, entry.contentPath),
    );
    const service = new TemplateSourceService(
      join(root, "data"),
      fetch,
      async () => sha,
    );
    const local = {
      ...source,
      id: "local",
      repository: localDirectory,
      contentPath: "",
    };
    const routes = createProjectTemplateSourceRoutes(root, service);
    expect(
      (
        await routes.request("/project-template-source", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true, sources: [source, local] }),
        })
      ).status,
    ).toBe(202);
    await service.waitForRetrieval();
    expect((await service.current()).snapshot).toMatchObject({
      sources: [
        { commit: sha },
        { local: true, commit: null, directory: localDirectory },
      ],
      templates: [{ title: "Local overlay", sourceId: "local" }],
    });
    expect(
      await readFile(
        join(localDirectory, "templates/app/instructions.md"),
        "utf8",
      ),
    ).toContain("~/agents/");
    expect(fetch).toHaveBeenCalledTimes(1);
    await service.configure({ enabled: true, sources: [local, source] });
    await service.waitForRetrieval();
    expect((await service.current()).snapshot?.templates[0]?.sourceId).toBe(
      source.id,
    );
  });

  it("reports a local Git owner's HEAD but revalidates working files without copying them", async () => {
    await fixture(root, "project-templates");
    const repository = await realpath(join(root, "repository"));
    const git = (args: string[]) =>
      promisify(execFile)("git", ["-C", repository, ...args]);
    await git(["init"]);
    await git(["add", "--", "project-templates", "topics"]);
    await git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-m",
      "Template fixture",
    ]);
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const service = new TemplateSourceService(join(root, "data"));
    const local = {
      ...source,
      repository: join(repository, "project-templates"),
      contentPath: "",
    };
    await service.configure({ enabled: true, sources: [local] });
    await service.waitForRetrieval();
    expect((await service.current()).snapshot?.sources[0]).toMatchObject({
      local: true,
      commit: head,
      directory: repository,
      contentPath: "project-templates",
    });
    const path = join(
      repository,
      "project-templates/templates/app/template.json",
    );
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.title = "Uncommitted local edit";
    await writeFile(path, JSON.stringify(manifest));
    await service.configure({ enabled: true, sources: [local] });
    await service.waitForRetrieval();
    expect((await service.current()).snapshot?.templates[0]?.title).toBe(
      "Uncommitted local edit",
    );
    expect((await service.current()).snapshot?.sources[0]?.commit).toBe(head);
  });

  it("rejects escaping roots and unsafe repositories", () => {
    for (const contentPath of ["../topics", "/etc", ".git", "x/../../y"]) {
      expect(
        templateSourceConfig.safeParse({
          ...config,
          sources: [{ ...source, contentPath }],
        }).success,
      ).toBe(false);
    }
    expect(
      templateSourceConfig.safeParse({
        ...config,
        sources: [{ ...source, repository: "file:///private" }],
      }).success,
    ).toBe(false);
  });

  it("leaves binary content and other repository aliases unchanged", async () => {
    await writeFile(
      join(root, "binary"),
      Buffer.from("\0~/agents/topics/guide.md"),
    );
    await writeFile(
      join(root, "readme.md"),
      "[Guide](~/agents/topics/guide.md)\n~/other/file\n~/local[base]/guide.md\n",
    );
    const local = join(root, "local[base]");
    expect(
      await relocateTemplateReferences(root, source.repository, [
        { repository: source.repository, directory: root },
        { repository: local, directory: local },
      ]),
    ).toBe(1);
    expect(await readFile(join(root, "readme.md"), "utf8")).toContain(
      `${local.replaceAll("\\", "/")}/guide.md`,
    );
    expect(await readFile(join(root, "readme.md"), "utf8")).toContain(
      `(${root}/topics/guide.md)`,
    );
    expect(await readFile(join(root, "binary"), "utf8")).toBe(
      "\0~/agents/topics/guide.md",
    );
  });
});
