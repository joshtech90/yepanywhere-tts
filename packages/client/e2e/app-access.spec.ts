import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const serverRequire = createRequire(join(root, "packages/server/package.json"));
let child: ChildProcess | undefined;
let upstream: Server;
let directory: string;
let port: number;
let upstreamPort: number;
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await exit;
  child = undefined;
}
async function start() {
  child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(serverRequire.resolve("tsx")).href,
      "--conditions",
      "source",
      join(root, "packages/server/test/fixtures/app-access-server.ts"),
      directory,
      String(port),
      String(upstreamPort),
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  let output = "";
  child.stderr!.on("data", (data) => {
    output += data;
  });
  const started = child;
  await new Promise<void>((resolve, reject) => {
    started.once("message", () => resolve());
    started.once("exit", (code) =>
      reject(new Error(`Fixture exited ${code}: ${output}`)),
    );
    started.once("error", reject);
  });
}
test.beforeAll(async () => {
  const scratch = join(root, ".artifacts/app-access-browser");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "run-"));
  await writeFile(join(directory, "index.html"), "<h1>Durable artifact</h1>");
  upstream = createServer((request, response) => {
    if (request.url === "/asset.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        'document.querySelector("h1").textContent = "App assets loaded";',
      );
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<h1>App</h1><script src="/asset.js"></script>');
    }
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  upstreamPort = (upstream.address() as { port: number }).port;
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve),
  );
  port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  await start();
});
test.afterAll(async () => {
  await stop();
  if (upstream) {
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (directory) await rm(directory, { recursive: true });
});

test("private app assets, transferable links and revocation survive process restart", async ({
  browser,
  request,
}) => {
  test.setTimeout(45_000);
  const base = `http://127.0.0.1:${port}`;
  const issued = await (await request.post(`${base}/test/issue`)).json();
  const owner = await browser.newContext();
  const outsider = await browser.newContext();
  try {
    const page = await owner.newPage();
    const stranger = await outsider.newPage();
    expect(
      (await stranger.goto(`http://plan.localhost:${port}/`))!.status(),
    ).toBe(401);
    await page.goto(issued.app);
    await expect(page.getByRole("heading")).toHaveText("App assets loaded");
    // Exercise the iframe as well as the top-level link in a fresh cookie jar.
    await owner.clearCookies();
    await page.goto(base);
    await page.setContent(`<iframe src="${issued.app}"></iframe>`);
    await expect(page.frameLocator("iframe").getByRole("heading")).toHaveText(
      "App assets loaded",
    );
    await stop();
    await start();
    await page.goto(issued.app);
    await expect(page.getByRole("heading")).toHaveText("App assets loaded");
    await page.goto(issued.grant.url);
    await expect(page.getByRole("heading")).toHaveText("Durable artifact");
    expect(
      (await request.get(`${base}/share/${issued.share.secret}`)).status(),
    ).toBe(200);
    await stranger.goto(`http://public.localhost:${port}/`);
    await expect(stranger.getByRole("heading")).toHaveText("App assets loaded");
    expect(
      (
        await request.post(`${base}/test/revoke`, {
          data: { grant: issued.grant.id, share: issued.share.id },
        })
      ).status(),
    ).toBe(200);
    await stop();
    await start();
    expect((await page.goto(issued.app))!.status()).toBe(401);
    expect((await page.goto(issued.grant.url))!.status()).toBe(404);
    expect(
      (await request.get(`${base}/share/${issued.share.secret}`)).status(),
    ).toBe(404);
  } finally {
    await owner.close();
    await outsider.close();
  }
});
