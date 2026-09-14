import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDesktopUpdaterMetadata } from "./normalize-updater-json.mjs";

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}
function validateIdentity({ tag, version, sha }) {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    ![`desktop-v${version}`, `desktop-latest-v${version}`].includes(tag)
  )
    throw new Error("Invalid desktop release identity");
}

export function validateRelease(metadata, assets, { repo, tag, version }) {
  if (metadata.version !== version)
    throw new Error("Updater version does not match release");
  const names = new Set(assets.map((asset) => asset.name));
  const required = [
    `YepAnywhere_${version}_aarch64.dmg`,
    `YepAnywhere_${version}_x64.dmg`,
    `YepAnywhere_${version}_x64-setup.exe`,
  ];
  for (const name of required)
    if (!names.has(name)) throw new Error(`Missing installer: ${name}`);
  if (assets.some((asset) => /\.msi(?:\.sig)?$/i.test(asset.name)))
    throw new Error("MSI releases are unsupported");
  for (const key of [
    "darwin-aarch64",
    "darwin-x86_64",
    "windows-x86_64",
    "windows-x86_64-nsis",
  ]) {
    if (!metadata.platforms?.[key])
      throw new Error(`Missing signed updater target: ${key}`);
  }
  for (const [key, candidate] of Object.entries(metadata.platforms)) {
    if (!candidate?.signature || !candidate?.url)
      throw new Error(`Missing signed updater target: ${key}`);
    const prefix = `https://github.com/${repo}/releases/download/${tag}/`;
    if (!candidate.url.startsWith(prefix))
      throw new Error(`Updater URL escapes immutable release: ${key}`);
    const name = decodeURIComponent(candidate.url.slice(prefix.length));
    if (!names.has(name) || !names.has(`${name}.sig`))
      throw new Error(`Missing updater artifact or signature: ${name}`);
  }
  return metadata;
}

function main() {
  const sha = process.env.RELEASE_SHA;
  const tag = process.env.RELEASE_TAG;
  const baseVersion = JSON.parse(
    readFileSync("packages/desktop/package.json", "utf8"),
  ).version;
  const version = process.env.RELEASE_VERSION || baseVersion;
  const nightly = tag?.startsWith("desktop-latest-v") ?? false;
  const repo = process.env.GITHUB_REPOSITORY;
  if (process.argv[2] === "prepare") {
    if (!/^[a-f0-9]{40}$/.test(sha))
      throw new Error("Exact source SHA required");
    let releaseId = "";
    if (tag) {
      validateIdentity({ tag, version, sha });
      if (!nightly && version !== baseVersion)
        throw new Error("Stable tag must match source version");
      // A matching private draft is retryable; a public or foreign release is not.
      let existing;
      try {
        existing = JSON.parse(
          gh(
            "release",
            "view",
            tag,
            "--json",
            "databaseId,isDraft,isPrerelease,targetCommitish",
          ),
        );
      } catch (error) {
        if (!/(HTTP 404|release not found)/i.test(String(error.stderr)))
          throw error;
      }
      if (existing) {
        if (
          !existing.isDraft ||
          existing.targetCommitish !== sha ||
          existing.isPrerelease !== nightly
        )
          throw new Error("Refusing to overwrite a public or foreign release");
        releaseId = existing.databaseId;
      } else {
        gh(
          "release",
          "create",
          tag,
          "--draft",
          "--target",
          sha,
          "--title",
          `Yep Anywhere Desktop ${nightly ? "Latest " : ""}v${version}`,
          "--notes",
          `Source commit: ${sha}`,
          ...(nightly ? ["--prerelease"] : []),
        );
        releaseId = JSON.parse(
          gh(
            "release",
            "view",
            tag,
            "--json",
            "databaseId,isDraft,isPrerelease,targetCommitish",
          ),
        ).databaseId;
      }
    }
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `release_id=${releaseId}\npublish=${Boolean(tag)}\ntag=${tag || ""}\nversion=${version}\nsha=${sha}\nnightly=${nightly}\n`,
    );
    return;
  }
  validateIdentity({ tag, version, sha });
  const release = JSON.parse(
    gh(
      "release",
      "view",
      tag,
      "--json",
      "isDraft,isPrerelease,targetCommitish,assets",
    ),
  );
  if (
    !release.isDraft ||
    release.isPrerelease !== nightly ||
    release.targetCommitish !== sha
  )
    throw new Error(
      "Release must be the private draft for this exact source and channel",
    );
  const directory = mkdtempSync(join(tmpdir(), "ya-desktop-release-"));
  try {
    gh("release", "download", tag, "--dir", directory);
    const metadata = normalizeDesktopUpdaterMetadata(
      JSON.parse(readFileSync(join(directory, "latest.json"), "utf8")),
    );
    validateRelease(metadata, release.assets, { repo, tag, version });
    const conf = JSON.parse(
      readFileSync("packages/desktop/src-tauri/tauri.conf.json", "utf8"),
    );
    const key = join(directory, "updater.pub");
    writeFileSync(key, Buffer.from(conf.plugins.updater.pubkey, "base64"));
    const verified = new Set();
    for (const candidate of Object.values(metadata.platforms)) {
      const name = basename(new URL(candidate.url).pathname);
      if (verified.has(name)) continue;
      const signature = readFileSync(
        join(directory, `${name}.sig`),
        "utf8",
      ).trim();
      if (signature !== candidate.signature.trim())
        throw new Error(
          `Metadata signature differs from artifact signature: ${name}`,
        );
      const decoded = join(directory, `${name}.minisig`);
      writeFileSync(decoded, Buffer.from(signature, "base64"));
      execFileSync(
        "minisign",
        ["-Vm", join(directory, name), "-p", key, "-x", decoded],
        { stdio: "inherit" },
      );
      verified.add(name);
    }
    writeFileSync(
      join(directory, "latest.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    gh("release", "upload", tag, join(directory, "latest.json"), "--clobber");
    const notes = join(directory, "notes.md");
    const base = `https://github.com/${repo}/releases/download/${tag}`;
    const changelog = readFileSync("packages/desktop/CHANGELOG.md", "utf8");
    const stableNotes =
      changelog
        .split(`## [${version}]`)[1]
        ?.split(/\n## /)[0]
        ?.replace(/^.*\n/, "")
        .trim() || "";
    writeFileSync(
      notes,
      `${nightly ? "Nightly Latest build. Install explicitly; returning to Stable waits for a newer release or requires a manual reinstall." : stableNotes}\n\nSource commit: [${sha}](https://github.com/${repo}/commit/${sha})\n\n| Platform | Download |\n| --- | --- |\n| macOS Apple Silicon | [DMG](${base}/YepAnywhere_${version}_aarch64.dmg) |\n| macOS Intel | [DMG](${base}/YepAnywhere_${version}_x64.dmg) |\n| Windows | [Per-user installer](${base}/YepAnywhere_${version}_x64-setup.exe) |\n`,
    );
    gh(
      "release",
      "edit",
      tag,
      "--notes-file",
      notes,
      "--draft=false",
      ...(nightly ? ["--latest=false"] : []),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
