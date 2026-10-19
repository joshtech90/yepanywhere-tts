/**
 * Vite config for the Chrome extension client (docs/tactical/151).
 *
 * Builds the remote client and the side panel into
 * packages/browser-extension/dist; vite.config.extension-worker.ts adds the
 * background worker and that package's assemble script the manifest.
 * Manifest V3 extension pages run only scripts packaged with the extension,
 * so the inline scripts the web entry carries become files here. The hosted
 * remote build is untouched.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Plugin, type PluginOption, defineConfig } from "vite";
import remoteConfig from "./vite.config.remote";

const INLINE_SCRIPT =
  /<script(?![^>]*\btype\s*=\s*["']module["'])(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Move each inline classic script into its own file at the same position.
 * An external classic script still runs synchronously during parse, so the
 * theme bootstrap and pre-boot composer keep their ordering. Runs post-order
 * ahead of the CSP plugin, which then finds no inline script to hash.
 */
function extensionEntryPlugin(): Plugin {
  const scripts = new Map<string, string>();
  return {
    name: "vite-plugin-extension-entry",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        let index = 0;
        return (
          html
            .replace(INLINE_SCRIPT, (_tag, content: string) => {
              const fileName = `inline-${index++}.js`;
              scripts.set(fileName, content);
              return `<script src="/${fileName}"></script>`;
            })
            // The extension's manifest.json replaces the web app manifest.
            .replace(/\s*<link rel="manifest"[^>]*>/, "")
        );
      },
    },
    async writeBundle(options) {
      const dir = options.dir;
      if (!dir) throw new Error("extension entry: no output directory");
      for (const [fileName, content] of scripts) {
        await writeFile(resolve(dir, fileName), content);
      }
    },
  };
}

export default defineConfig((env) => {
  const remote = remoteConfig(env);
  const plugins = (remote.plugins ?? []).flat() as PluginOption[];
  const csp = plugins.findIndex(
    (plugin) =>
      !!plugin && "name" in plugin && plugin.name === "vite-plugin-csp",
  );
  if (csp < 0) throw new Error("extension build: CSP plugin not found");
  plugins.splice(csp, 0, extensionEntryPlugin());
  return {
    ...remote,
    cacheDir: process.env.YEP_EXTENSION_DEV_BUILD_ID
      ? "node_modules/.vite-extension-dev"
      : "node_modules/.vite-extension",
    define: {
      ...remote.define,
      __EXTENSION_DEV_BUILD_ID__: JSON.stringify(
        process.env.YEP_EXTENSION_DEV_BUILD_ID ?? "",
      ),
    },
    plugins,
    build: {
      ...remote.build,
      outDir:
        process.env.YEP_EXTENSION_OUT_DIR ??
        resolve(__dirname, "../browser-extension/dist"),
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        ...remote.build?.rollupOptions,
        // play.html hosts public-share frames, which the extension omits.
        input: {
          main: resolve(__dirname, "remote.html"),
          sidepanel: resolve(__dirname, "sidepanel.html"),
        },
      },
    },
  };
});
