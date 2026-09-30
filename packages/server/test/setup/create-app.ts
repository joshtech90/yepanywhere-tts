import { trackFixtureApp } from "./app-fixture-lifecycle.js";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AppOptions,
  type AppResult,
  createApp as createProductionApp,
} from "../../src/app.js";

const EMPTY_PROVIDER_ROOT = join(
  tmpdir(),
  `yep-server-test-providers-${process.pid}-${randomUUID()}`,
);

/**
 * Build the full server app without inheriting a developer's provider history.
 * Tests that exercise provider discovery opt into their fixture directories by
 * passing the corresponding AppOptions override.
 */
export function createApp(options: AppOptions): AppResult {
  const root = process.env.YEP_DATA_DIR;
  if (options.dataDir == null && !root) {
    throw new Error("Full-app test fixtures require the hermetic test setup");
  }
  // createProductionApp does not consult YEP_DATA_DIR. Resolve it here, with a
  // distinct database for each app; restart tests can still share an explicit
  // dataDir. The file's hermetic setup owns cleanup of these directories.
  const dataDir = options.dataDir ?? join(root!, `app-${randomUUID()}`);
  const result = createProductionApp({
    codexSessionsDir: join(EMPTY_PROVIDER_ROOT, "codex"),
    geminiSessionsDir: join(EMPTY_PROVIDER_ROOT, "gemini"),
    grokSessionsDir: join(EMPTY_PROVIDER_ROOT, "grok"),
    piSessionsDir: join(EMPTY_PROVIDER_ROOT, "pi"),
    provider: null,
    getLatestVersion: async () => null,
    ...options,
    dataDir,
  });
  trackFixtureApp(result);
  return result;
}
