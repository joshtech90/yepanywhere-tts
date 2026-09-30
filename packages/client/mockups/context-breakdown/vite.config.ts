import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: false,
  plugins: [react()],
  resolve: { conditions: ["source"] },
  build: {
    outDir: "../../../../.artifacts/mockups/context-breakdown",
    emptyOutDir: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1024,
  },
});
