import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { build } = require("esbuild");
const dist = resolve("packages/browser-extension/dist");
await build({
  entryPoints: ["research/extension-artifact-spike/sandbox.mjs"],
  bundle: true,
  format: "iife",
  outfile: resolve(dist, "artifact-sandbox.js"),
});
writeFileSync(
  resolve(dist, "artifact-sandbox.html"),
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="artifact-sandbox.js"></script>',
);
const path = resolve(dist, "manifest.json");
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.name = "Yep Anywhere — Artifact Research";
manifest.sandbox = { pages: ["artifact-sandbox.html"] };
manifest.content_security_policy.sandbox =
  "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
writeFileSync(path, JSON.stringify(manifest, null, 2));
console.log(
  "Packaged isolated research sandbox; production assembly unchanged",
);
