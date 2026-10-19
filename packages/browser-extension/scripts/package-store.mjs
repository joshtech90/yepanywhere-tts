// Audit the actual loadable build, then create a store ZIP with its manifest
// at the archive root. Python's standard ZIP library works without npm deps.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const dist = resolve(root, "dist");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json")));
const identity = JSON.parse(
  await readFile(
    resolve(repo, "docs/distribution/chrome-extension/identity.json"),
  ),
);
const { version } = JSON.parse(await readFile(resolve(root, "package.json")));
const id = [
  ...createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest("hex")
    .slice(0, 32),
]
  .map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16)))
  .join("");
assert.equal(id, identity.id, "Store ID must match the packaged public key");
assert.equal(manifest.version, version);
assert.equal(manifest.manifest_version, 3);
assert.equal(
  manifest.name,
  "Yep Anywhere",
  "Development builds cannot be packaged for the store",
);
assert.deepEqual([...manifest.permissions].sort(), [
  "activeTab",
  "contextMenus",
  "sidePanel",
  "storage",
]);
assert.deepEqual(manifest.optional_host_permissions, [
  "https://*/*",
  "http://*/*",
]);
for (const forbidden of [
  "host_permissions",
  "content_scripts",
  "externally_connectable",
  "sandbox",
])
  assert.equal(
    manifest[forbidden],
    undefined,
    `Unexpected manifest field: ${forbidden}`,
  );

async function filesUnder(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "Store package must not contain symlinks");
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      files.push(
        ...(await filesUnder(resolve(directory, entry.name), `${name}/`)),
      );
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}
const files = await filesUnder(dist);
assert(
  !files.includes("dev-build.json"),
  "Development build signal in store package",
);
for (const name of files) {
  assert(!name.endsWith(".map"), `Source map in store package: ${name}`);
  assert(
    !name.startsWith(".") &&
      !name.includes("/.") &&
      !/\.(pem|key|secret)$/.test(name),
    `Private file: ${name}`,
  );
  if (name.endsWith(".html")) {
    const html = await readFile(resolve(dist, name), "utf8");
    for (const script of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    )) {
      assert(!script[2].trim(), `Inline script in ${name}`);
      const src = /\bsrc=["']([^"']+)["']/.exec(script[1])?.[1];
      assert(
        src && !/^(?:[a-z]+:|\/\/)/i.test(src),
        `Remote or missing script source in ${name}`,
      );
      assert(files.includes(src.replace(/^\//, "")), `Missing script ${src}`);
    }
  }
}
for (const name of [
  "index.html",
  "sidepanel.html",
  "options.html",
  "options.js",
  "background.js",
  ...Object.values(manifest.icons),
])
  assert(files.includes(name), `Missing packaged entry: ${name}`);
for (const size of [16, 32, 48, 128]) {
  const png = await readFile(resolve(dist, manifest.icons[size]));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();
const sourceDirty = Boolean(
  execFileSync("git", ["status", "--porcelain"], {
    cwd: repo,
    encoding: "utf8",
  }).trim(),
);
console.log(
  `Store audit passed: ${id}, version ${version}, ${files.length} packaged files`,
);
if (process.argv.includes("--check")) process.exit(0);
const release = resolve(root, "release");
await mkdir(release, { recursive: true });
const filename = `yep-anywhere-chrome-${version}.zip`;
const zip = resolve(release, filename);
const python = process.platform === "win32" ? "py" : "python3";
execFileSync(python, [
  ...(process.platform === "win32" ? ["-3"] : []),
  "-c",
  `import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file():
   info=zipfile.ZipInfo(p.relative_to(root).as_posix(),(2026,1,1,0,0,0))
   info.compress_type=zipfile.ZIP_DEFLATED
   info.external_attr=0o100644<<16
   z.writestr(info,p.read_bytes())
with zipfile.ZipFile(sys.argv[2]) as z:
 assert z.testzip() is None
 assert 'manifest.json' in z.namelist()
`,
  dist,
  zip,
]);
const sha256 = createHash("sha256")
  .update(await readFile(zip))
  .digest("hex");
await writeFile(
  resolve(release, `${filename}.sha256`),
  `${sha256}  ${filename}\n`,
);
await writeFile(
  resolve(release, "build.json"),
  `${JSON.stringify({ version, extensionId: id, revision, sourceDirty, filename, sha256, files: files.length }, null, 2)}\n`,
);
console.log(`Store upload: ${zip}\nSHA-256: ${sha256}`);
