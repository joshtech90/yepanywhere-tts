import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDirectoryBrowseRoutes,
  type DirectoryBrowseResponse,
} from "../../src/routes/directory-browse.js";

describe("directory-browse routes", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dir-browse-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("lists only dirs sorted numerically (a2 before a10)", async () => {
    const app = createDirectoryBrowseRoutes();
    await mkdir(join(tempDir, "a10"));
    await mkdir(join(tempDir, "a2"));
    await mkdir(join(tempDir, "a1"));
    await writeFile(join(tempDir, "file.txt"), "hello");

    const res = await app.request("/?path=" + encodeURIComponent(tempDir));
    expect(res.status).toBe(200);

    const data = (await res.json()) as DirectoryBrowseResponse;
    expect(data.path).toBe(resolve(tempDir));
    expect(data.parent).toBe(dirname(resolve(tempDir)));
    expect(data.home).toBe(homedir());
    expect(data.entries).toEqual([
      { name: "a1", path: join(tempDir, "a1") },
      { name: "a2", path: join(tempDir, "a2") },
      { name: "a10", path: join(tempDir, "a10") },
    ]);
    expect(data.truncated).toBe(false);
  });

  it("hides dot dirs unless hidden=1", async () => {
    const app = createDirectoryBrowseRoutes();
    await mkdir(join(tempDir, ".hidden-dir"));
    await mkdir(join(tempDir, "visible-dir"));

    const defaultRes = await app.request(
      "/?path=" + encodeURIComponent(tempDir),
    );
    expect(defaultRes.status).toBe(200);
    const defaultData = (await defaultRes.json()) as DirectoryBrowseResponse;
    expect(defaultData.entries).toEqual([
      { name: "visible-dir", path: join(tempDir, "visible-dir") },
    ]);

    const hiddenRes = await app.request(
      "/?path=" + encodeURIComponent(tempDir) + "&hidden=1",
    );
    expect(hiddenRes.status).toBe(200);
    const hiddenData = (await hiddenRes.json()) as DirectoryBrowseResponse;
    expect(hiddenData.entries).toEqual([
      { name: ".hidden-dir", path: join(tempDir, ".hidden-dir") },
      { name: "visible-dir", path: join(tempDir, "visible-dir") },
    ]);
  });

  // Creating symlinks needs extra privileges on Windows.
  it.skipIf(process.platform === "win32")(
    "includes symlink to dir and ignores broken symlink",
    async () => {
      const app = createDirectoryBrowseRoutes();
      const realDir = join(tempDir, "real-dir");
      const symlinkDir = join(tempDir, "symlink-dir");
      const brokenSymlink = join(tempDir, "broken-symlink");
      const realFile = join(tempDir, "file.txt");
      const fileSymlink = join(tempDir, "symlink-file");

      await mkdir(realDir);
      await writeFile(realFile, "file content");
      await symlink(realDir, symlinkDir, "dir");
      await symlink(join(tempDir, "does-not-exist"), brokenSymlink, "dir");
      await symlink(realFile, fileSymlink, "file");

      const res = await app.request("/?path=" + encodeURIComponent(tempDir));
      expect(res.status).toBe(200);

      const data = (await res.json()) as DirectoryBrowseResponse;
      expect(data.entries).toEqual([
        { name: "real-dir", path: realDir },
        { name: "symlink-dir", path: symlinkDir },
      ]);
    },
  );

  it("returns 404 for missing directory", async () => {
    const app = createDirectoryBrowseRoutes();
    const missing = join(tempDir, "missing-dir");

    const res = await app.request("/?path=" + encodeURIComponent(missing));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Directory not found" });
  });

  it("returns 400 for a file path", async () => {
    const app = createDirectoryBrowseRoutes();
    const filePath = join(tempDir, "some-file.txt");
    await writeFile(filePath, "hello");

    const res = await app.request("/?path=" + encodeURIComponent(filePath));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Not a directory" });
  });

  it("returns 400 for relative path", async () => {
    const app = createDirectoryBrowseRoutes();

    const res = await app.request(
      "/?path=" + encodeURIComponent("relative/dir"),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path must be absolute" });
  });

  it("returns 400 for paths with NUL bytes or length exceeding 4096", async () => {
    const app = createDirectoryBrowseRoutes();

    const nulRes = await app.request(
      "/?path=" + encodeURIComponent("/tmp/test\0bad"),
    );
    expect(nulRes.status).toBe(400);
    expect(await nulRes.json()).toEqual({ error: "Invalid path" });

    const longRes = await app.request(
      "/?path=" + encodeURIComponent("/" + "a".repeat(4097)),
    );
    expect(longRes.status).toBe(400);
    expect(await longRes.json()).toEqual({ error: "Invalid path" });
  });

  it("returns parent null for '/'", async () => {
    const app = createDirectoryBrowseRoutes();

    const res = await app.request("/?path=" + encodeURIComponent("/"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as DirectoryBrowseResponse;
    expect(data.parent).toBeNull();
    expect(data.path).toBe(resolve("/"));
  });

  it("resolves '~' to os.homedir()", async () => {
    const app = createDirectoryBrowseRoutes();

    const res = await app.request("/?path=" + encodeURIComponent("~"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as DirectoryBrowseResponse;
    expect(data.path).toBe(homedir());
  });

  it("defaults to '~' when path query parameter is omitted", async () => {
    const app = createDirectoryBrowseRoutes();

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const data = (await res.json()) as DirectoryBrowseResponse;
    expect(data.path).toBe(homedir());
  });

  it("caps entries at 500 and sets truncated: true", async () => {
    const app = createDirectoryBrowseRoutes();
    const createdDirs = Array.from({ length: 505 }, (_, i) =>
      mkdir(join(tempDir, `d-${String(i).padStart(3, "0")}`)),
    );
    await Promise.all(createdDirs);

    const res = await app.request("/?path=" + encodeURIComponent(tempDir));
    expect(res.status).toBe(200);
    const data = (await res.json()) as DirectoryBrowseResponse;
    expect(data.entries.length).toBe(500);
    expect(data.truncated).toBe(true);
  });
});
