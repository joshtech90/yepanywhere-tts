import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { warningFreeBuildLogger } from "../../vite-build-policy";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: false,
  customLogger: warningFreeBuildLogger("Path breadcrumbs mockup"),
  plugins: [react()],
  resolve: { conditions: ["source"] },
  build: {
    outDir: "../../../../.artifacts/mockups/path-breadcrumbs",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1024,
  },
});
