import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(
  new URL("../app/src/main/assets/download.js", import.meta.url),
  "utf8",
);
async function download(response, maxBytes = 100, blob) {
  const messages = [];
  const context = vm.createContext({
    Blob,
    window: { __yepBlobs: new Map([["blob:test", blob]]) },
    fetch: async (_url, options) => {
      assert.equal(options.credentials, "same-origin");
      return response;
    },
    FileReader: class {
      async readAsDataURL(value) {
        this.result = `data:${value.type};base64,${Buffer.from(await value.arrayBuffer()).toString("base64")}`;
        this.onload();
      }
    },
    YepApp: { postMessage: (message) => messages.push(JSON.parse(message)) },
  });
  await vm.runInContext(`${script}; downloadFile`, context)(
    blob ? "blob:test" : "https://host.test/file",
    "report.txt",
    maxBytes,
  );
  return messages;
}

test("HTTP failures never become saved downloads", async () => {
  for (const status of [401, 404, 500]) {
    const [message] = await download(new Response("Error page", { status }));
    assert.match(message.fehler ?? "", new RegExp(`HTTP ${status}`));
    assert.equal(message.daten, undefined);
  }
});

test("downloads preserve bytes and names for HTTP and retained blobs", async () => {
  for (const blob of [undefined, new Blob(["Hello"], { type: "text/plain" })]) {
    const [message] = await download(
      new Response("Hello", { headers: { "Content-Type": "text/plain" } }),
      100,
      blob,
    );
    assert.equal(message.name, "report.txt");
    assert.equal(message.daten, "data:text/plain;base64,SGVsbG8=");
  }
});

test("unknown-length oversized responses stop reading before buffering the file", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(64));
        if (reads === 10) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const [message] = await download(new Response(stream), 100);
  assert.match(message.fehler, /zu gross/);
  assert.equal(message.daten, undefined);
  assert.equal(cancelled, true);
  assert.ok(reads <= 2, `read ${reads} chunks`);
});
