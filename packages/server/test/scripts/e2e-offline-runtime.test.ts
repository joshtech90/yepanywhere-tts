import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { UPDATE_SERVER_URL } from "../../src/routes/version.js";

const exec = promisify(execFile);
it("owns update responses while forwarding actual fixture HTTP traffic", async () => {
  const server = createServer((_request, response) =>
    response.end("owned endpoint"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  const url = `http://127.0.0.1:${address.port}/version/test`;
  const preload = pathToFileURL(
    join(
      resolve(import.meta.dirname, "../../../.."),
      "packages/client/e2e/support/fixture-runtime.mjs",
    ),
  ).href;
  const blockPublicNetwork = `data:text/javascript,${encodeURIComponent(`
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== '127.0.0.1') throw new Error('Unexpected public request');
      return original(input, init);
    };
  `)}`;
  try {
    const result = await exec(
      process.execPath,
      [
        "--import",
        blockPublicNetwork,
        "--import",
        preload,
        "--input-type=module",
        "-e",
        `
      const update = await fetch(new Request('https://updates.yepanywhere.com/version/test'));
      const own = await fetch(${JSON.stringify(url)});
      process.stdout.write(JSON.stringify({ update: update.status, own: own.status, body: await own.text() }));
    `,
      ],
      { timeout: 5000, maxBuffer: 4096 },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      update: 204,
      own: 200,
      body: "owned endpoint",
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("intercepts only the production update origin and version path", async () => {
  const preload = pathToFileURL(
    join(
      resolve(import.meta.dirname, "../../../.."),
      "packages/client/e2e/support/offline-update-check.mjs",
    ),
  ).href;
  const result = await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      const calls = [];
      globalThis.fetch = async (input) => {
        calls.push(input instanceof Request ? input.url : String(input));
        return new Response('forwarded', { status: 201 });
      };
      await import(${JSON.stringify(preload)});
      const owned = ${JSON.stringify(`${UPDATE_SERVER_URL}/test`)};
      const ownedStatuses = await Promise.all([owned, new URL(owned), new Request(owned)].map(async input => (await fetch(input)).status));
      const nearMisses = [
        'http://updates.yepanywhere.com/version/test',
        'https://updates.yepanywhere.com.evil/version/test',
        'https://updates.yepanywhere.com/versions/test',
        'https://updates.yepanywhere.com:444/version/test',
        'https://updates.yepanywhere.com/version'
      ];
      const forwarded = await Promise.all(nearMisses.map(async input => (await fetch(input)).status));
      process.stdout.write(JSON.stringify({ ownedStatuses, forwarded, exactForwarding: JSON.stringify(calls) === JSON.stringify(nearMisses) }));
      `,
    ],
    { timeout: 5000, maxBuffer: 4096 },
  );
  expect(JSON.parse(result.stdout)).toEqual({
    ownedStatuses: [204, 204, 204],
    forwarded: [201, 201, 201, 201, 201],
    exactForwarding: true,
  });
});
