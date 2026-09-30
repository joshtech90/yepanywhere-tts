import type { AppResult } from "../../src/app.js";

const apps = new Set<AppResult>();

export function trackFixtureApp(app: AppResult): void {
  // Browser fixtures use the same pure app factory and dispose explicitly.
  if (process.env.VITEST) apps.add(app);
}

export async function drainFixtureApps(): Promise<void> {
  const results = await Promise.allSettled(
    Array.from(apps, async (app) => {
      app.stopNotifications();
      await app.disposeSessionReaders();
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Full-app fixture cleanup failed",
    );
  apps.clear();
}
