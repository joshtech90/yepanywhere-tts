import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { exportDirectory, fixtureRoot, manifest } from "./mockups/export";
import { warningFreeBuildLogger } from "./vite-build-policy";

export default defineConfig({
  root: fixtureRoot,
  base: "./",
  publicDir: false,
  customLogger: warningFreeBuildLogger("Mockup"),
  plugins: [
    react(),
    {
      name: "ya-mockup-manifest",
      enforce: "post",
      configureServer(server) {
        server.middlewares.use("/ya-mockup.json", (_request, response) => {
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({ ...manifest, files: [], screenshots: [] }),
          );
        });
      },
      generateBundle(_options, bundle) {
        this.emitFile({
          type: "asset",
          fileName: "ya-mockup.json",
          source: JSON.stringify(
            {
              ...manifest,
              files: [...Object.keys(bundle), "ya-mockup.json"].sort(),
              screenshots: [],
            },
            null,
            2,
          ),
        });
      },
    },
  ],
  resolve: { conditions: ["source"] },
  build: {
    outDir: exportDirectory,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: { "react-runtime": ["react", "react-dom/client"] },
      },
    },
  },
});
