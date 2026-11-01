import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FolderListingResponse } from "@yep-anywhere/shared";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createFilesRoutes } from "../../src/routes/files.js";

describe("folder listing route", () => {
  let root: string;
  let projectDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "ya-folder-list-")));
    projectDir = join(root, "project");
    outsideDir = join(root, "outside");
    await mkdir(join(projectDir, "paper", "sections", "figures"), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, "paper", "sections", "_10-intro.qmd"),
      "a",
    );
    await writeFile(
      join(projectDir, "paper", "sections", "_20-method.qmd"),
      "bb",
    );
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "secret.txt"), "s");
    await symlink(outsideDir, join(projectDir, "escape"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createApp(
    options: { principal?: Principal; strict?: boolean } = {},
  ) {
    const projectId = toUrlProjectId(projectDir);
    const routes = createFilesRoutes({
      scanner: {
        async getProject(id: string) {
          return id === projectId ? { id, path: projectDir } : null;
        },
        async listProjects() {
          return [{ id: projectId, path: projectDir }];
        },
      } as unknown as ProjectScanner,
      allowedPaths: () => [outsideDir],
      includeProjects: () => true,
      ...(options.strict ? { strictProjectFileAccess: true } : {}),
    });
    const app = new Hono();
    if (options.principal) {
      const principal = options.principal;
      app.use("*", async (c, next) => {
        c.set(PRINCIPAL_VARIABLE as never, principal as never);
        await next();
      });
    }
    app.route("/", routes);
    return (path: string) =>
      app.request(`/${projectId}/files/list?path=${encodeURIComponent(path)}`);
  }

  it("lists one folder's direct children with kinds and sizes", async () => {
    const response = await createApp()("paper/sections");
    expect(response.status).toBe(200);
    const body = (await response.json()) as FolderListingResponse;
    expect(body.path).toBe("paper/sections");
    expect(body.truncated).toBe(false);
    expect(
      body.entries.map(({ name, kind, size }) => ({ name, kind, size })),
    ).toEqual([
      { name: "_10-intro.qmd", kind: "file", size: 1 },
      { name: "_20-method.qmd", kind: "file", size: 2 },
      { name: "figures", kind: "folder", size: undefined },
    ]);
  });

  it("lists the project root for an empty path and refuses to climb above it", async () => {
    const list = createApp();
    const rootListing = (await (
      await list("")
    ).json()) as FolderListingResponse;
    expect(rootListing.entries.map((entry) => entry.name)).toEqual([
      "escape",
      "paper",
    ]);
    expect((await list("..")).status).toBe(400);
    expect((await list("paper/../..")).status).toBe(400);
  });

  it("refuses a linked folder that leaves the project", async () => {
    expect((await createApp()("escape")).status).toBe(400);
  });

  it("reports a file path as not a folder", async () => {
    expect((await createApp()("paper/sections/_10-intro.qmd")).status).toBe(
      400,
    );
  });

  it("keeps host paths to the superuser", async () => {
    const limited = createApp({
      principal: { kind: "limited", username: "guest" } as unknown as Principal,
    });
    expect((await limited(outsideDir)).status).toBe(403);
    const superuser = createApp({ principal: { kind: "superuser" } });
    const listing = (await (
      await superuser(outsideDir)
    ).json()) as FolderListingResponse;
    expect(listing.entries.map((entry) => entry.name)).toEqual(["secret.txt"]);
  });

  it("never lists from a share-scoped instance", async () => {
    expect((await createApp({ strict: true })("paper")).status).toBe(404);
  });
});
