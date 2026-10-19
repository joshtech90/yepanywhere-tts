import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadShellAssets } from "../../../artifact-host/assets.mjs";
import { serve, VERSION } from "../../../artifact-host/host.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "../client/dist-remote");
const destination = resolve(packageRoot, "app/build/generated/webAssets");

const remoteHtml = await readFile(resolve(source, "remote.html"), "utf8");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
await writeFile(resolve(destination, "index.html"), remoteHtml);
await rm(resolve(destination, "remote.html"));

// Only these generated, versioned shell assets enter native interception.
const parent = "https://appassets.androidplatform.net";
const viewer = "0".repeat(32);
const assets = await loadShellAssets([parent]);
const shell = resolve(destination, "artifact-shell");
await mkdir(shell, { recursive: true });
const manifest = { version: Number(VERSION), assets: {} };
for (const name of [
  "bootstrap.html",
  "bootstrap.js",
  "worker.js",
  "frame.js",
]) {
  const query =
    name === "bootstrap.html"
      ? `?${new URLSearchParams({ parent, viewer })}`
      : "";
  const response = serve(
    new Request(
      `https://artifact-${viewer}.yepanywhere.com/__ya/${VERSION}/${name}${query}`,
    ),
    assets,
    { PARENT_ORIGINS: JSON.stringify([parent]) },
  );
  if (response.status !== 200)
    throw new Error("Packaged artifact shell generation failed");
  const text = await response.text();
  if (Buffer.byteLength(text) > 512 * 1024)
    throw new Error("Packaged shell asset exceeds its bound");
  await writeFile(resolve(shell, name), text);
  manifest.assets[name] = Object.fromEntries(response.headers);
}
await writeFile(resolve(shell, "manifest.json"), JSON.stringify(manifest));
