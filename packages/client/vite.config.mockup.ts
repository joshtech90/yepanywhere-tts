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
    /*
     * This fixture bundle is never shipped: it exists so the export spec can
     * check that a mockup builds and renders. Vite's default 500 kB chunk
     * warning would therefore fail the warning-free gate on any incidental
     * growth of the app code the fixture happens to import — it sat 2% under
     * the limit and tripped on a handful of new i18n strings. Shipped-payload
     * discipline belongs to the client build (DEVELOPMENT.md § Contribution
     * Ethos), not to this fixture.
     */
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: { "react-runtime": ["react", "react-dom/client"] },
      },
    },
  },
});
