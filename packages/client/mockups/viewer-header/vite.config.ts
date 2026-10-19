import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { warningFreeBuildLogger } from "../../vite-build-policy";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: false,
  customLogger: warningFreeBuildLogger("Viewer header mockup"),
  plugins: [react()],
  resolve: {
    conditions: ["source"],
    alias: [
      {
        find: /^\.\.\/hooks\/use(?:RemoteBasePath|FileVersionControl)$/,
        replacement: fileURLToPath(
          new URL("./fixtureServices.ts", import.meta.url),
        ),
      },
    ],
  },
  build: {
    outDir: "../../../../.artifacts/mockups/viewer-header",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1024,
  },
});
