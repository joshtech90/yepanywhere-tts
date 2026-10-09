import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Historical reproductions; repaired cases also have normal unit coverage.
// This opt-in configuration remains excluded from pnpm test by e2e/**.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: { conditions: ["source"] },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    },
    include: ["e2e/lifecycle-study/*.repro.ts"],
    exclude: ["node_modules/**"],
    passWithNoTests: false,
  },
});
