// ESLint lints only authored CSS here; Biome owns TypeScript/JavaScript lint
// and all formatting. Rule choices and rejections: topics/css-architecture.md
// § CSS lint rules.
import cssicorn from "eslint-cssicorn";
import { defineConfig } from "eslint/config";

// packages/desktop is outside Biome's scope as well; mockups are throwaway.
const authoredCss = ["packages/client/src/**/*.css", "site/src/**/*.css"];

export default defineConfig([
  {
    ...cssicorn.configs.all,
    files: authoredCss,
  },
  {
    files: authoredCss,
    rules: {
      // Rejected as style churn with no defect prevented.
      "cssicorn/lowercase": "off",
      "cssicorn/prefer-modern-syntax": "off",
      "cssicorn/prefer-short-hex-color": "off",
    },
  },
]);
