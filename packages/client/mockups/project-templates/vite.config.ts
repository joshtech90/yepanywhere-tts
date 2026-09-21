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
    outDir: "../../../../.artifacts/mockups/project-templates",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // Isolated review fixture, never part of the shipped client.
    chunkSizeWarningLimit: 1024,
  },
});
