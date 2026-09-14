import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Relay prepares a fixed set of statements and reuses them. Node cannot
      // observe the difference between that and preparing per call, because
      // StatementSync has no finalize and the collector reclaims each one;
      // under Bun the per-call pattern retains every statement until close.
      // Failing here keeps the ordinary `pnpm test` path, and therefore CI,
      // honest about it without anyone opting in.
      YEP_SQLITE_STATEMENT_CEILING: "64",
    },
  },
});
