/**
 * Vite config for the Chrome extension's background worker (docs/tactical/151).
 *
 * Bundles src/extension/background.ts into one module file beside the
 * extension build, so the worker shares the client's connection and lookup
 * code. Run after vite.config.extension.ts, which empties the directory.
 */

import { resolve } from "node:path";
import { defineConfig } from "vite";
import remoteConfig from "./vite.config.remote";

export default defineConfig((env) => {
  const remote = remoteConfig(env);
  return {
    cacheDir: "node_modules/.vite-extension-worker",
    customLogger: remote.customLogger,
    envPrefix: remote.envPrefix,
    resolve: remote.resolve,
    // Library mode leaves process.env.NODE_ENV in dependencies such as React
    // (reached through shared settings hooks); a worker has no `process`.
    define: {
      ...remote.define,
      __EXTENSION_DEV_WORKER_HASH__: JSON.stringify(
        process.env.YEP_EXTENSION_DEV_WORKER_STAMP ?? "",
      ),
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    publicDir: false,
    build: {
      outDir:
        process.env.YEP_EXTENSION_OUT_DIR ??
        resolve(__dirname, "../browser-extension/dist"),
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      lib: {
        entry: resolve(__dirname, "src/extension/background.ts"),
        formats: ["es"],
        fileName: () => "background.js",
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  };
});
