import { defineConfig } from "@playwright/test";

if (process.env.NO_COLOR) delete process.env.NO_COLOR;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "mockup-export.spec.ts",
  outputDir: "../../.artifacts/mockup-test-results",
  workers: 1,
  timeout: 60000,
  reporter: "list",
  use: { browserName: "chromium", locale: "en-US", reducedMotion: "reduce" },
});
