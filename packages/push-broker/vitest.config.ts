import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // See packages/relay/vitest.config.ts: the broker reuses one prepared
      // statement per SQL, and only a ceiling makes a regression to preparing
      // per call visible on Node, where it looks free.
      YEP_SQLITE_STATEMENT_CEILING: "64",
    },
  },
});
