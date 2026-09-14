import { defineConfig } from "@playwright/test";
if (process.env.NO_COLOR) delete process.env.NO_COLOR;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "tool-display-contracts.spec.ts",
  workers: 1,
  reporter: "list",
  timeout: 30000,
  use: { headless: true },
});
