import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type FileOwnerResponse, toUrlProjectId } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createFileOwnerRoutes } from "../../src/routes/file-owner.js";
import type { Project } from "../../src/supervisor/types.js";

describe("file-owner route", () => {
  let base: string;

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "yep-file-owner-")));
    await mkdir(join(base, "c"), { recursive: true });
    await symlink(join(base, "c"), join(base, "link"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  });

  async function file(path: string): Promise<string> {
    const absolute = join(base, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, "x\n");
    return absolute;
  }

  /** `a` is the conversation's project; `link` is a symlink to `c`. */
  async function createApp(principal?: Principal) {
    const projects = ["a", "b", "b/nested", "link"].map((name) => {
      const path = join(base, name);
      return { id: toUrlProjectId(path), path } as Project;
    });
    const current = projects[0]!;
    const routes = createFileOwnerRoutes({
      scanner: {
        async getProject(id: string) {
          return projects.find((project) => project.id === id) ?? null;
        },
        async listProjects() {
          return projects;
        },
      } as unknown as ProjectScanner,
      allowedPaths: () => [join(base, "outside")],
      includeProjects: () => true,
    });
    const app = new Hono();
    if (principal) {
      app.use("*", async (c, next) => {
        c.set(PRINCIPAL_VARIABLE as never, principal as never);
        await next();
      });
    }
    app.route("/", routes);
    return async (path: string) => {
      const response = await app.request(
        `/${current.id}/file-owner?path=${encodeURIComponent(path)}`,
      );
      return {
        status: response.status,
        body: (await response.json()) as FileOwnerResponse,
      };
    };
  }

  it("names the project that owns a file linked from another project", async () => {
    const lookup = await createApp();
    const path = await file("b/gaps/example.md");
    expect(await lookup(path)).toEqual({
      status: 200,
      body: {
        owner: {
          projectId: toUrlProjectId(join(base, "b")),
          projectPath: join(base, "b"),
          relativePath: "gaps/example.md",
        },
      },
    });
  });

  it("gives a nested project its own files", async () => {
    const lookup = await createApp();
    const path = await file("b/nested/gaps/example.md");
    const { body } = await lookup(path);
    expect(body.owner?.projectPath).toBe(join(base, "b/nested"));
    expect(body.owner?.relativePath).toBe("gaps/example.md");
  });

  it("matches a symlinked project root through either spelling", async () => {
    const lookup = await createApp();
    const resolved = await file("c/docs/notes.md");
    const expected = {
      projectId: toUrlProjectId(join(base, "link")),
      projectPath: join(base, "link"),
      relativePath: "docs/notes.md",
    };
    expect((await lookup(resolved)).body.owner).toEqual(expected);
    expect((await lookup(join(base, "link/docs/notes.md"))).body.owner).toEqual(
      expected,
    );
  });

  it("expands ~/ against the server's home", async () => {
    const lookup = await createApp();
    await file("b/build/review.pdf");
    vi.stubEnv("HOME", base);
    const { body } = await lookup("~/b/build/review.pdf");
    expect(body.owner?.projectPath).toBe(join(base, "b"));
    expect(body.owner?.relativePath).toBe("build/review.pdf");
  });

  it("reports an allowed file outside every project as unowned", async () => {
    const lookup = await createApp();
    const path = await file("outside/report.md");
    expect(await lookup(path)).toEqual({ status: 200, body: { owner: null } });
  });

  it("refuses missing files, disallowed files, and limited users", async () => {
    const lookup = await createApp();
    expect((await lookup(join(base, "b/missing.md"))).status).toBe(404);
    const disallowed = await file("elsewhere/secret.md");
    expect((await lookup(disallowed)).status).toBe(403);
    const limited = await createApp({
      kind: "limited",
      username: "alice",
    } as unknown as Principal);
    expect((await limited(await file("b/x.md"))).status).toBe(403);
  });
});
