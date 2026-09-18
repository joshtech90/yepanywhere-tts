import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listLocallyExcludedPaths } from "../../src/git/locallyExcluded.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function write(root: string, path: string, body: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

describe("listLocallyExcludedPaths", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ya-locally-excluded-"));
    git(root, "init", "-q");
    write(root, ".gitignore", "node_modules/\nRelease/\n/tasks/\n");
    write(root, ".git/info/exclude", "/reviews/\n/notes.local.md\n/tasks/\n");
    write(root, "src/main.ts", "export {};\n");
    write(root, "node_modules/pkg/README.md", "# dependency\n");
    write(root, "Release/build.log", "built\n");
    write(root, "tasks/041-plan.md", "# plan\n");
    write(root, "reviews/pr-7.md", "# review\n");
    write(root, "reviews/nested/pr-8.md", "# review\n");
    write(root, "notes.local.md", "# notes\n");
    git(root, "add", "-A");
    git(
      root,
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "commit",
      "-qm",
      "init",
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists files excluded by this clone's info/exclude, expanding directories", async () => {
    await expect(listLocallyExcludedPaths(root)).resolves.toEqual([
      "notes.local.md",
      "reviews/nested/pr-8.md",
      "reviews/pr-7.md",
    ]);
  });

  it("omits .gitignore content even when info/exclude names the same path", async () => {
    // `.gitignore` wins the ignore decision for tasks/, so Source Control
    // treats it as shared build-style exclusion and never lists it.
    const paths = await listLocallyExcludedPaths(root);
    expect(paths.some((path) => path.startsWith("tasks/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("Release/"))).toBe(false);
  });

  it("returns nothing when the clone excludes nothing locally", async () => {
    write(root, ".git/info/exclude", "");
    await expect(listLocallyExcludedPaths(root)).resolves.toEqual([]);
  });
});
