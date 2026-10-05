import { defineConfig } from "@playwright/test";
import sessionState from "./playwright.session-state.config";

// Router browser fixtures own their Vite listener and synthetic API surface.
// The SHA-pinned AAR suite owns real server/provider process integration.
export default defineConfig(sessionState, {
  testMatch: ["router-pools.spec.ts", "router-recovery.spec.ts"],
});
