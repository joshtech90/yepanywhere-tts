import { expect, test } from "./fixtures";

test("production clients preserve the native measurement timeline", async ({
  page,
  baseURL,
  remotePreviewURL,
}) => {
  test.setTimeout(30_000);
  for (const url of [baseURL, remotePreviewURL]) {
    await page.goto(`${url}/login`);
    await expect(page.locator("#root")).not.toBeEmpty();
    await page.evaluate(() => {
      for (let i = 0; i < 512; i++) {
        performance.measure("production-native-check", {
          start: 0,
          end: 1,
          detail: { devtools: { track: "Components ⚛" } },
        });
      }
    });
    // Cross the development cleanup interval as well as its count limit.
    await page.waitForTimeout(5_100);
    const entries = await page.evaluate(() =>
      performance
        .getEntriesByName("production-native-check", "measure")
        .map((entry) => (entry as PerformanceMeasure).detail),
    );
    expect(entries).toHaveLength(512);
    expect(entries[0]).toEqual({ devtools: { track: "Components ⚛" } });
  }
});

for (const bounded of [false, true]) {
  test(`development React timing is ${bounded ? "bounded" : "unbounded in the control"}`, async ({
    page,
    remoteClientURL,
  }) => {
    if (!bounded) {
      await page.route(
        "**/src/lib/developmentPerformanceBootstrap.ts*",
        (route) =>
          route.fulfill({
            contentType: "application/javascript",
            body: "export {};",
          }),
      );
    }
    await page.goto(`${remoteClientURL}/login`);
    await expect(page.locator("#root")).not.toBeEmpty();
    const result = await page.evaluate(async () => {
      const modulePath = "/e2e/support/development-performance-workload.ts";
      const { runDevelopmentPerformanceWorkload } = await import(modulePath);
      return runDevelopmentPerformanceWorkload();
    });
    expect(result.renderedRows).toBe(200);
    console.info("[DevelopmentPerformance]", { bounded, ...result });
    expect(result.finalText).toBe("19");
    if (bounded) {
      expect(result.snapshot.react.count).toBeGreaterThan(1_000);
      expect(result.nativeEntries).toBeLessThan(256);
      expect(result.entriesWithDetail).toBe(0);
    } else {
      expect(result.snapshot).toBeNull();
      expect(result.nativeEntries).toBeGreaterThan(1_000);
      expect(result.entriesWithDetail).toBeGreaterThan(1_000);
    }
  });
}
