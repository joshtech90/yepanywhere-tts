// Complete the client build in dist/ as a loadable Manifest V3 extension.
// `pnpm build:extension` runs the client's extension and worker Vite builds
// first.

import { execFileSync } from "node:child_process";
import {
  cp,
  copyFile,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const dist = resolve(
  process.env.YEP_EXTENSION_OUT_DIR ?? resolve(packageRoot, "dist"),
);
const development = Boolean(process.env.YEP_EXTENSION_DEV_BUILD_ID);

// The store identity: its public key gives unpacked builds the store's id.
const identity = JSON.parse(
  await readFile(
    resolve(repoRoot, "docs/distribution/chrome-extension/identity.json"),
    "utf8",
  ),
);

// The extension has its own store versions, independent of YA server tags.
const { version } = JSON.parse(
  await readFile(resolve(packageRoot, "package.json"), "utf8"),
);
if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
  version.split(".").some((part) => Number(part) > 65535) ||
  version.split(".").every((part) => Number(part) === 0)
) {
  throw new Error("Expected a nonzero three-part Chrome store version");
}
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

await rename(resolve(dist, "remote.html"), resolve(dist, "index.html"));
// Web-host files the extension does not use. The web app manifest would also
// collide with the extension's manifest.json.
for (const name of ["sw.js", "_headers", "debug-streaming.html"]) {
  await rm(resolve(dist, name), { force: true });
}
for (const name of ["options.html", "options.js"]) {
  await copyFile(resolve(packageRoot, "src", name), resolve(dist, name));
}
await cp(resolve(packageRoot, "src/icons"), resolve(dist, "icons"), {
  recursive: true,
});
const icons = Object.fromEntries(
  [16, 32, 48, 128].map((size) => [size, `icons/icon-${size}.png`]),
);

const manifest = {
  manifest_version: 3,
  name: development ? "Yep Anywhere (Dev)" : "Yep Anywhere",
  description:
    "Supervise coding agents on your servers and find related sessions beside GitHub issues, pull requests and Jira tickets.",
  version,
  version_name: `${version}${development ? " dev" : ""} (${revision.slice(0, 9)})`,
  key: identity.key,
  icons,
  action: {
    default_title: "Yep Anywhere",
    default_icon: icons,
  },
  background: { service_worker: "background.js", type: "module" },
  side_panel: { default_path: "sidepanel.html" },
  options_page: "options.html",
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
  // None of these shows an install warning (docs/tactical/151 design rule).
  // activeTab lets a toolbar click read that one page's address;
  // contextMenus adds items to the toolbar button's right-click menu.
  permissions: ["sidePanel", "storage", "activeTab", "contextMenus"],
  // Requested per site from the side panel or options, never at install:
  // reading a granted site's addresses drives automatic lookup.
  optional_host_permissions: ["https://*/*", "http://*/*"],
};
await writeFile(
  resolve(dist, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Extension ${version} (${revision}) assembled in ${dist}`);
