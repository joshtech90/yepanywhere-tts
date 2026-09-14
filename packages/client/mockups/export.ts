import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const clientRoot = fileURLToPath(new URL("../", import.meta.url));
export const exportDirectory = resolve(
  clientRoot,
  "../../.artifacts/mockups/projects",
);
export const fixtureRoot = resolve(clientRoot, "mockups/projects");
export const viewports = [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
];
export const states = [
  { name: "default", entry: "index.html" },
  { name: "selected", entry: "index.html?state=selected" },
];
export const manifest = {
  format: "ya-ui-mockup",
  version: 1,
  title: "YA project review",
  entry: "index.html",
  presentation: "scripted",
  theme: "dark",
  locale: "en",
  font: "YA Inter",
  states,
  viewports,
  regenerate: "pnpm --filter @yep-anywhere/client mockup:export",
};
