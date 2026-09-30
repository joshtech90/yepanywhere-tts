import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyVersion,
  canAdvanceVerifiedSource,
  isDesktopInput,
  latestPublished,
  listMainPushRuns,
  nightlyIdentity,
  selectVerifiedCommit,
} from "./nightly-release.mjs";
import { validateRelease } from "./desktop-release.mjs";

const sha = "a".repeat(40);
test("nightly reads the run inventory and filters main pushes across pages", () => {
  const other = { head_branch: "feature", event: "push" };
  const pr = { head_branch: "main", event: "pull_request" };
  const dispatch = { head_branch: "main", event: "workflow_dispatch" };
  const main = (id) => ({ id, head_branch: "main", event: "push" });
  const pages = [
    [main("newest"), pr, dispatch, ...Array(97).fill(other)],
    [main("older"), other],
  ];
  const requested = [];
  assert.deepEqual(listMainPushRuns((page) => {
    requested.push(page);
    return pages[page - 1];
  }), [main("newest"), main("older")]);
  assert.deepEqual(requested, [1, 2]);
  assert.equal(listMainPushRuns(() => Array.from({ length: 100 }, (_, i) => main(i))).length, 100);
});
test("nightly cannot republish older source when newer CI eligibility changes", () => {
  const history = ["old-green", "published", "new-green"];
  const ancestor = (base, tip) =>
    history.includes(base) && history.includes(tip) &&
    history.indexOf(base) <= history.indexOf(tip);
  const candidate = selectVerifiedCommit([
    { head_sha: "new-green", status: "completed", conclusion: "failure" },
    { head_sha: "old-green", status: "completed", conclusion: "success" },
  ], () => true);
  assert.equal(candidate.head_sha, "old-green");
  assert.equal(canAdvanceVerifiedSource("published", candidate.head_sha, ancestor), false);
  assert.equal(canAdvanceVerifiedSource("published", "published", ancestor), true);
  assert.equal(canAdvanceVerifiedSource("published", "new-green", ancestor), true);
  assert.throws(() => canAdvanceVerifiedSource("published", "diverged", ancestor), /diverges/);
});
test("nightly includes bundled source and build inputs but skips docs and test-only changes", () => {
  for (const path of [
    "packages/client/src/App.tsx",
    "packages/server/src/index.ts",
    "packages/shared/src/types.ts",
    "packages/desktop/src-tauri/Cargo.lock",
    "pnpm-lock.yaml",
    "scripts/build-bundle.mjs",
    ".github/workflows/desktop-ci.yml",
    "packages/server/src/prompts/tool.md",
  ])
    assert.equal(isDesktopInput(path), true, path);
  for (const path of [
    "docs/roadmap/README.md",
    "site/src/pages/index.astro",
    "packages/server/test/sdk.test.ts",
    "packages/client/src/App.test.tsx",
    "packages/client/e2e/desktop.ts",
    "packages/desktop/README.md",
  ])
    assert.equal(isDesktopInput(path), false, path);
});
test("versions increase across attempts and runs and stay below a later stable minor", () => {
  assert.equal(nightlyIdentity("0.2.0", 1, 1, sha).version, "0.3.101");
  assert.equal(nightlyIdentity("0.2.0", 1, 2, sha).version, "0.3.102");
  assert.equal(nightlyIdentity("0.4.0", 2, 1, sha).version, "0.5.201");
  for (const [base, run, attempt] of [
    ["0.255.0", 1, 1],
    ["0.2.0", 656, 1],
    ["0.2.0", 1, 100],
    ["0.2.0", 0, 1],
  ])
    assert.throws(() => nightlyIdentity(base, run, attempt, sha));
});
test("release selection ignores drafts and stable and compares versions numerically", () => {
  const release = (tag, draft = false, prerelease = true) => ({
    tag_name: tag,
    draft,
    prerelease,
  });
  assert.equal(
    latestPublished([
      release("desktop-latest-v0.3.901"),
      release("desktop-latest-v0.3.1001"),
      release("desktop-latest-v0.3.1101", true),
      release("desktop-v0.4.0", false, false),
    ]).tag_name,
    "desktop-latest-v0.3.1001",
  );
});
test("one generated identity reaches package, Tauri, Cargo and lockfile without changing dependencies", () => {
  const directory = mkdtempSync(join(tmpdir(), "ya-nightly-test-"));
  try {
    mkdirSync(join(directory, "src-tauri"));
    for (const name of ["package.json", "src-tauri/tauri.conf.json"])
      writeFileSync(
        join(directory, name),
        '{"version":"0.2.0","identifier":"keep"}',
      );
    writeFileSync(
      join(directory, "src-tauri/Cargo.toml"),
      '[package]\nversion = "0.2.0"\n[dependencies]\nother = "1"\n',
    );
    writeFileSync(
      join(directory, "src-tauri/Cargo.lock"),
      '[[package]]\nname = "other"\nversion = "1.0.0"\n[[package]]\nname = "yep-anywhere-desktop"\nversion = "0.2.0"\n',
    );
    applyVersion(directory, "0.3.101");
    assert.deepEqual(
      JSON.parse(readFileSync(join(directory, "package.json"))),
      { version: "0.3.101", identifier: "keep" },
    );
    assert.match(
      readFileSync(join(directory, "src-tauri/Cargo.lock"), "utf8"),
      /name = "other"\nversion = "1.0.0"/,
    );
    assert.match(
      readFileSync(join(directory, "src-tauri/Cargo.lock"), "utf8"),
      /name = "yep-anywhere-desktop"\nversion = "0.3.101"/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("publication refuses incomplete or foreign updater artifacts", () => {
  const version = "0.3.101",
    tag = `desktop-latest-v${version}`,
    repo = "example/app";
  const files = [
    `YepAnywhere_${version}_aarch64.dmg`,
    `YepAnywhere_${version}_x64.dmg`,
    `YepAnywhere_${version}_x64-setup.exe`,
    "mac-arm.tar.gz",
    "mac-intel.tar.gz",
  ];
  const candidate = (name) => ({
    url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    signature: "signed artifact",
  });
  const metadata = {
    version,
    platforms: {
      "darwin-aarch64": candidate(files[3]),
      "darwin-x86_64": candidate(files[4]),
      "windows-x86_64": candidate(files[2]),
      "windows-x86_64-nsis": candidate(files[2]),
    },
  };
  const assets = files.flatMap((name) => [{ name }, { name: `${name}.sig` }]);
  assert.equal(
    validateRelease(metadata, assets, { repo, tag, version }),
    metadata,
  );
  assert.throws(
    () =>
      validateRelease(
        metadata,
        assets.filter((a) => a.name !== files[0]),
        { repo, tag, version },
      ),
    /Missing installer/,
  );
  const partial = structuredClone(metadata);
  delete partial.platforms["darwin-x86_64"];
  assert.throws(
    () => validateRelease(partial, assets, { repo, tag, version }),
    /Missing signed updater target/,
  );
  const foreign = structuredClone(metadata);
  foreign.platforms["darwin-aarch64"].url = "https://example.com/wrong.tar.gz";
  assert.throws(
    () => validateRelease(foreign, assets, { repo, tag, version }),
    /escapes/,
  );
  assert.throws(
    () =>
      validateRelease(metadata, [...assets, { name: "other.msi" }], {
        repo,
        tag,
        version,
      }),
    /MSI/,
  );
});

test("selection rejects pending, failed reruns and commits outside main", () => {
  const run = (head_sha, conclusion, status = "completed") => ({
    head_sha,
    conclusion,
    status,
  });
  const runs = [
    run("pending", null, "in_progress"),
    run("retry", "failure"),
    run("retry", "success"),
    run("foreign", "success"),
    run("verified", "success"),
  ];
  assert.equal(
    selectVerifiedCommit(runs, (sha) => sha !== "foreign").head_sha,
    "verified",
  );
  assert.equal(
    selectVerifiedCommit(runs.slice(0, 3), () => true),
    undefined,
  );
});
