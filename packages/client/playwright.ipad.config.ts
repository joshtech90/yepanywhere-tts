import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

if (process.env.NO_COLOR) delete process.env.NO_COLOR;

// Safari's engine for the iPad Home Screen check; the spec sets iPad metrics.
export default defineConfig({
  ...base,
  testMatch: "ipad-home-screen.spec.ts",
  outputDir: `test-results/ipad-${randomUUID()}`,
  use: { ...base.use, browserName: "webkit" },
});
