import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type GitWorkingTreeFileListResult,
  toUrlProjectId,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createGitWorkingTreeFilesRoutes } from "../../src/routes/git-working-tree-files.js";
import type { Project } from "../../src/supervisor/types.js";

const execFileAsync = promisify(execFile);

describe("git-working-tree-files root option", () => {
  let projectDir: string;
  let allowedDir: string;
  let outsideDir: string;
  let dataDir: string;

  beforeEach(async () => {
    projectDir = await realpath(await mkdtemp(join(tmpdir(), "yep-lsb-proj-")));
    allowedDir = await realpath(await mkdtemp(join(tmpdir(), "yep-lsb-ok-")));
    outsideDir = await realpath(await mkdtemp(join(tmpdir(), "yep-lsb-no-")));
    dataDir = await mkdtemp(join(tmpdir(), "yep-lsb-data-"));
  });

  afterEach(async () => {
    await Promise.all(
      [projectDir, allowedDir, outsideDir, dataDir].map((dir) =>
        rm(dir, { recursive: true, force: true }),
      ),
    );
  });

  function createApp(principal?: Principal) {
    const projectId = toUrlProjectId(projectDir);
    const project = { id: projectId, path: projectDir } as Project;
    const routes = createGitWorkingTreeFilesRoutes({
      scanner: {
        async getProject(id: string) {
          return id === projectId ? project : null;
        },
        async listProjects() {
          return [project];
        },
      } as unknown as ProjectScanner,
      dataDir,
      allowedPaths: () => [allowedDir],
      includeProjects: () => false,
    });
    const app = new Hono();
    if (principal) {
      app.use("*", async (c, next) => {
        c.set(PRINCIPAL_VARIABLE as never, principal as never);
        await next();
      });
    }
    app.route("/", routes);
    return {
      get: (root: string) =>
        app.request(
          `/${projectId}/git/working-tree-files?root=${encodeURIComponent(root)}`,
        ),
    };
  }

  it("browses the enclosing checkout and locates the requested file", async () => {
    const repo = join(allowedDir, "repo");
    await mkdir(join(repo, "src"), { recursive: true });
    await execFileAsync("git", ["-C", repo, "init"]);
    await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
    await writeFile(join(repo, "src", "a.ts"), "a\n");
    await writeFile(join(repo, "ignored.txt"), "x\n");
    await execFileAsync("git", ["-C", repo, "add", ".gitignore", "src/a.ts"]);
    await writeFile(join(repo, "new.txt"), "n\n");

    const response = await createApp().get(join(repo, "src", "a.ts"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as GitWorkingTreeFileListResult;
    expect(body.root).toEqual({
      path: repo,
      isGitRepo: true,
      requestedFile: "src/a.ts",
    });
    expect(body.files.map((file) => [file.path, file.kind])).toEqual([
      [".gitignore", "tracked"],
      ["new.txt", "untracked"],
      ["src/a.ts", "tracked"],
    ]);
  });

  it("walks a plain directory, skipping nothing but .git", async () => {
    await mkdir(join(allowedDir, "d", "e"), { recursive: true });
    await writeFile(join(allowedDir, "d", "one.txt"), "1\n");
    await writeFile(join(allowedDir, "d", "e", "two.txt"), "2\n");

    const response = await createApp().get(join(allowedDir, "d"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as GitWorkingTreeFileListResult;
    expect(body.root).toEqual({
      path: join(allowedDir, "d"),
      isGitRepo: false,
    });
    expect(body.files.map((file) => file.path)).toEqual([
      "e/two.txt",
      "one.txt",
    ]);
  });

  it("refuses paths outside the file-access allow-set", async () => {
    await writeFile(join(outsideDir, "secret.txt"), "s\n");
    const response = await createApp().get(join(outsideDir, "secret.txt"));
    expect(response.status).toBe(403);
  });

  it("refuses a limited principal", async () => {
    await writeFile(join(allowedDir, "a.txt"), "a\n");
    const response = await createApp({
      kind: "limited",
      username: "guest",
    } as Principal).get(allowedDir);
    expect(response.status).toBe(403);
  });
});
