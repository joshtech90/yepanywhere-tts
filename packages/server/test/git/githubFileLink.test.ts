import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { githubFileLink } from "../../src/git/githubFileLink.js";

const exec = promisify(execFile);
let dir: string;
let commit: string;
const git = async (...args: string[]) =>
  (await exec("git", ["-C", dir, ...args])).stdout.trim();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ya-github-link-"));
  await git("init");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.com");
  await writeFile(join(dir, "a #é.txt"), "hello\n");
  await git("add", "--", "a #é.txt");
  await git("commit", "-m", "file");
  commit = await git("rev-parse", "HEAD");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("selects a GitHub remote containing the file revision and encodes its path", async () => {
  await git("remote", "add", "origin", "git@github.com:upstream/repo.git");
  await git("remote", "add", "fork", "https://github.com/me/repo.git");
  await git("update-ref", "refs/remotes/fork/main", commit);
  expect(await githubFileLink(dir, commit, "a #é.txt")).toEqual({
    url: `https://github.com/me/repo/blob/${commit}/a%20%23%C3%A9.txt`,
    pushed: true,
  });
});

it.each([
  "https://github.com/me/repo.git",
  "ssh://git@github.com/me/repo.git",
  "git@github.com:me/repo.git",
])("recognizes %s and marks an unpushed revision", async (url) => {
  await git("remote", "add", "origin", url);
  expect(await githubFileLink(dir, commit, "a #é.txt")).toEqual({
    url: `https://github.com/me/repo/blob/${commit}/a%20%23%C3%A9.txt`,
    pushed: false,
  });
});

it("does not confuse an unrelated remote or a newer local HEAD with the file revision", async () => {
  await git("remote", "add", "origin", "https://github.com/me/repo");
  await git("remote", "add", "elsewhere", "https://gitlab.com/me/repo");
  await git("update-ref", "refs/remotes/elsewhere/main", commit);
  expect((await githubFileLink(dir, commit, "a #é.txt"))?.pushed).toBe(false);
  await git("update-ref", "refs/remotes/origin/main", commit);
  await writeFile(join(dir, "other.txt"), "other\n");
  await git("add", "other.txt");
  await git("commit", "-m", "local-only unrelated change");
  expect((await githubFileLink(dir, commit, "a #é.txt"))?.pushed).toBe(true);
  expect(
    (await githubFileLink(dir, await git("rev-parse", "HEAD"), "other.txt"))
      ?.pushed,
  ).toBe(false);
});

it("omits non-GitHub remotes and paths absent from the commit", async () => {
  expect(await githubFileLink(dir, commit, "a #é.txt")).toBeNull();
  await git(
    "remote",
    "add",
    "origin",
    "https://github.com.evil.example/me/repo",
  );
  expect(await githubFileLink(dir, commit, "a #é.txt")).toBeNull();
  await git("remote", "set-url", "origin", "https://github.com/me/repo");
  expect(await githubFileLink(dir, commit, "missing.txt")).toBeNull();
});

it("honors configured remote order among remotes containing the revision", async () => {
  await git("remote", "add", "origin", "https://github.com/upstream/repo");
  await git("remote", "add", "fork", "https://github.com/me/repo");
  await git("update-ref", "refs/remotes/fork/main", commit);
  await git("update-ref", "refs/remotes/origin/main", commit);
  expect((await githubFileLink(dir, commit, "a #é.txt"))?.url).toContain(
    "github.com/upstream/repo/",
  );
  await git("update-ref", "-d", "refs/remotes/origin/main");
  expect((await githubFileLink(dir, commit, "a #é.txt"))?.url).toContain(
    "github.com/me/repo/",
  );
});
