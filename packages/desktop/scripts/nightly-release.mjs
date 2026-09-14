import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");

// Match the packaged runtime closure, including its build inputs. Test-only,
// documentation and marketing changes still run CI but do not ship new binaries.
export function isDesktopInput(file) {
  if (
    /(^|\/)(?:__tests__|tests|test|e2e|test-fixtures)\//.test(file) ||
    /\.(?:test|spec)\.[^/]+$/.test(file)
  )
    return false;
  if (/(^|\/)(?:README|CHANGELOG|AGENTS|CLAUDE)\.md$/.test(file)) return false;
  return (
    /^(?:packages\/(?:desktop|client|server|shared|browser-agent)\/|scripts\/|patches\/|update-server\/)/.test(
      file,
    ) ||
    /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|\.npmrc)$/.test(
      file,
    ) ||
    /^\.github\/workflows\/(?:ci|desktop-ci|nightly-desktop)\.yml$/.test(file)
  );
}

export function nightlyIdentity(baseVersion, runNumber, attempt, sha) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(baseVersion);
  if (!match || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error("Numeric base version and exact SHA are required");
  const major = Number(match[1]);
  const minor = Number(match[2]) + 1;
  if (
    !Number.isSafeInteger(runNumber) ||
    runNumber < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt > 99
  )
    throw new Error("Invalid workflow run/attempt");
  const patch = runNumber * 100 + attempt;
  if (major > 255 || minor > 255 || patch > 65535)
    throw new Error(
      "Nightly version exhausted native package bounds; start a new release train and workflow sequence",
    );
  const version = `${major}.${minor}.${patch}`;
  return { version, tag: `desktop-latest-v${version}`, sha };
}

export function applyVersion(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid package version");
  for (const name of ["package.json", "src-tauri/tauri.conf.json"]) {
    const file = join(directory, name);
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.version = version;
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  const cargo = join(directory, "src-tauri/Cargo.toml");
  writeFileSync(
    cargo,
    readFileSync(cargo, "utf8").replace(
      /^(version = )"[^"]+"/m,
      `$1"${version}"`,
    ),
  );
  const lock = join(directory, "src-tauri/Cargo.lock");
  writeFileSync(
    lock,
    readFileSync(lock, "utf8").replace(
      /(name = "yep-anywhere-desktop"\nversion = )"[^"]+"/,
      `$1"${version}"`,
    ),
  );
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
function api(path, projection = ".") {
  return JSON.parse(
    execFileSync("gh", ["api", path, "--jq", projection], { encoding: "utf8" }),
  );
}

export function latestPublished(releases) {
  return releases
    .filter(
      (r) =>
        !r.draft &&
        r.prerelease &&
        /^desktop-latest-v\d+\.\d+\.\d+$/.test(r.tag_name),
    )
    .sort((a, b) => {
      const av = a.tag_name.slice(16).split(".").map(Number);
      const bv = b.tag_name.slice(16).split(".").map(Number);
      return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
    })[0];
}

export function selectVerifiedCommit(runs, isAncestor) {
  const seen = new Set();
  return runs.find((run) => {
    if (seen.has(run.head_sha)) return false;
    seen.add(run.head_sha);
    return (
      run.status === "completed" &&
      run.conclusion === "success" &&
      isAncestor(run.head_sha)
    );
  });
}

function select() {
  const repo = process.env.GITHUB_REPOSITORY;
  // Require main's newest run for that SHA to pass, including reruns. Never
  // choose the scheduler's current HEAD while a different commit was verified.
  const runs = api(
    `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=100`,
    ".workflow_runs | map({id, head_sha, status, conclusion})",
  );
  const candidate = selectVerifiedCommit(
    runs,
    (sha) =>
      spawnSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"], {
        cwd: root,
        stdio: "pipe",
      }).status === 0,
  );
  if (!candidate)
    throw new Error("No verified main commit in the latest 100 CI runs");
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = api(
      `repos/${repo}/releases?per_page=100&page=${page}`,
      "map({tag_name, draft, prerelease})",
    );
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const previous = latestPublished(releases);
  const sha = candidate.head_sha;
  if (previous && process.env.FORCE_BUILD !== "true") {
    const old = git("rev-parse", `${previous.tag_name}^{commit}`);
    const changed = git("diff", "--name-only", old, sha)
      .split("\n")
      .filter(isDesktopInput);
    if (!changed.length) {
      appendFileSync(process.env.GITHUB_OUTPUT, "build=false\n");
      console.log(
        "Skipping: no packaged desktop inputs changed since the last published Latest.",
      );
      return;
    }
  }
  const baseVersion = JSON.parse(
    git("show", `${sha}:packages/desktop/package.json`),
  ).version;
  const identity = nightlyIdentity(
    baseVersion,
    Number(process.env.GITHUB_RUN_NUMBER),
    Number(process.env.GITHUB_RUN_ATTEMPT),
    sha,
  );
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `build=true\n${Object.entries(identity)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("")}`,
  );
  console.log(JSON.stringify({ ...identity, ciRun: candidate.id }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "apply") applyVersion(desktop, process.argv[3]);
  else select();
}
