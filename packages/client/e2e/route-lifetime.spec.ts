import { createServer, type Server } from "node:http";
import { expect, test } from "./fixtures.js";
import {
  drainManagedRoutes,
  routeWithDrain,
} from "./support/managed-routes.js";

test.use({ baseURL: "http://route-lifetime.test", draftSessionIds: [] });

let server: Server;
let requestUrl: string;
test.beforeAll(async () => {
  server = createServer((_request, response) => {
    // Inject latency, not a speed assertion: teardown must await this response.
    setTimeout(() => response.end("done"), 250);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  requestUrl = `http://127.0.0.1:${address.port}/pending`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("page fixture finishes an active route after the test body returns", async ({
  page,
}) => {
  let entered!: () => void;
  const routeEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await routeWithDrain(page, requestUrl, async (route) => {
    entered();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.evaluate((url) => {
    void fetch(url);
  }, requestUrl);
  await routeEntered;
  // Deliberately return with the handler active, as background refreshes do.
});

test("page fixture drains overlapping response handlers before removing routes", async ({
  page,
}) => {
  let entered = 0;
  let started!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const responses: string[] = [];
  await routeWithDrain(page, `${requestUrl}?*`, async (route) => {
    entered++;
    if (entered === 2) started();
    const response = await route.fetch();
    // The fast handler completes while its sibling still awaits its response.
    if (route.request().url().endsWith("slow"))
      await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      response,
      headers: { "access-control-allow-origin": "*" },
    });
    responses.push(route.request().url());
  });
  await page.evaluate((url) => {
    void fetch(`${url}?fast`);
    void fetch(`${url}?slow`);
  }, requestUrl);
  await bothStarted;
  await drainManagedRoutes(page);
  await page.unrouteAll({ behavior: "wait" });
  // Swallowing handler exceptions cannot satisfy both completed deliveries.
  expect(responses).toHaveLength(2);
});

test("page fixture accepts a page already closed by its owner", async ({
  page,
}) => {
  await page.close();
});
