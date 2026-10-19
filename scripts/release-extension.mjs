import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { versionParts } from "../packages/browser-extension/scripts/publish-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
assert(
  version && process.argv.length === 3,
  "Usage: scripts/release-extension.sh <version>",
);
const next = versionParts(version);
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
assert.equal(git("branch", "--show-current"), "main", "Release from main");
assert.equal(
  git("status", "--porcelain"),
  "",
  "Commit working-tree changes before releasing",
);
const packagePath = resolve(root, "packages/browser-extension/package.json");
const pkg = JSON.parse(await readFile(packagePath));
const previous = versionParts(pkg.version);
assert(
  (next[0] - previous[0] || next[1] - previous[1] || next[2] - previous[2]) > 0,
  "Choose a version newer than the current extension version",
);
const changelog = await readFile(
  resolve(root, "packages/browser-extension/CHANGELOG.md"),
  "utf8",
);
assert(
  changelog.includes(`## [${version}]`),
  "Add and commit the extension changelog entry first",
);
const tag = `extension-v${version}`;
assert.equal(
  git("tag", "--list", tag),
  "",
  "Release tag already exists locally",
);
assert.equal(
  git("ls-remote", "--tags", "origin", `refs/tags/${tag}`),
  "",
  "Release tag already exists remotely",
);
git("fetch", "origin", "main");
git("merge-base", "--is-ancestor", "origin/main", "HEAD");
pkg.version = version;
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
git("add", "packages/browser-extension/package.json");
git("commit", "-m", `Release Chrome extension ${version}`);
git("tag", tag);
execFileSync(
  "git",
  ["push", "--atomic", "origin", "HEAD:main", `refs/tags/${tag}`],
  { cwd: root, stdio: "inherit" },
);
console.log(
  `Queued ${tag}: https://github.com/kzahel/yepanywhere/actions/workflows/browser-extension.yml`,
);
