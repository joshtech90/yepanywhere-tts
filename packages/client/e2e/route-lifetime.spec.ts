import { createServer, type Server } from "node:http";
import { test } from "./fixtures.js";

test.use({ baseURL: "http://route-lifetime.test" });

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
  await page.route(requestUrl, async (route) => {
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

test("page fixture accepts a page already closed by its owner", async ({
  page,
}) => {
  await page.close();
});
