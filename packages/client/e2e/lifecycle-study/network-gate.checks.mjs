import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { createNetworkGate } from "./network-gate.mjs";

test("silent stall keeps sockets alive and restores ordered bytes; refusal cuts existing and new connections", {
  timeout: 5000,
}, async () => {
  const upstream = createServer((socket) => socket.pipe(socket));
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gate = await createNetworkGate(upstream.address().port);
  const client = createConnection(gate.port, "127.0.0.1");
  client.on("error", () => {});
  try {
    await once(client, "connect");
    let data = once(client, "data");
    client.write("before");
    assert.equal(String((await data)[0]), "before");
    gate.setMode("silent");
    client.write("pending");
    // Wait for actual receipt by the gate, not an assumed network delay.
    while (gate.snapshot().stalledBytes !== 7)
      await new Promise((done) => setImmediate(done));
    assert.equal(client.destroyed, false);
    data = once(client, "data");
    gate.setMode("pass");
    assert.equal(String((await data)[0]), "pending");
    data = once(client, "data");
    client.write("after");
    assert.equal(String((await data)[0]), "after");
    const closed = once(client, "close");
    gate.setMode("refuse");
    await closed;
    const refused = createConnection(gate.port, "127.0.0.1");
    refused.on("error", () => {});
    await once(refused, "close");
    assert.equal(gate.snapshot().refused, 1);
  } finally {
    client.destroy();
    await gate.close();
    await new Promise((done) => upstream.close(done));
  }
});

test("closing a gate while bytes are stalled releases its sockets", {
  timeout: 5000,
}, async () => {
  const upstream = createServer((socket) => socket.pipe(socket));
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gate = await createNetworkGate(upstream.address().port);
  const client = createConnection(gate.port, "127.0.0.1");
  client.on("error", () => {});
  try {
    await once(client, "connect");
    gate.setMode("silent");
    client.write("pending");
    while (gate.snapshot().stalledBytes !== 7)
      await new Promise((done) => setImmediate(done));
    const closed = once(client, "close");
    await gate.close();
    await closed;
    gate.setMode("pass");
    assert.equal(client.destroyed, true);
  } finally {
    client.destroy();
    await new Promise((done) => upstream.close(done));
  }
});

test("a byte-triggered cut interrupts existing traffic once and permits explicit recovery", {
  timeout: 5000,
}, async () => {
  const upstream = createServer((socket) => socket.pipe(socket));
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gate = await createNetworkGate(upstream.address().port);
  let client = createConnection(gate.port, "127.0.0.1");
  client.on("error", () => {});
  try {
    await once(client, "connect");
    gate.refuseAfterClientBytes(8);
    const echoed = once(client, "data");
    client.write("first");
    assert.equal(String((await echoed)[0]), "first");
    const closed = once(client, "close");
    client.write("second");
    await closed;
    assert.equal(gate.snapshot().cuts, 1);
    assert.equal(gate.snapshot().mode, "refuse");
    gate.setMode("pass");
    client = createConnection(gate.port, "127.0.0.1");
    client.on("error", () => {});
    await once(client, "connect");
    const retried = once(client, "data");
    client.write("explicit retry");
    assert.equal(String((await retried)[0]), "explicit retry");
    assert.equal(gate.snapshot().cuts, 1);
  } finally {
    client.destroy();
    await gate.close();
    await new Promise((done) => upstream.close(done));
  }
});

test("download pacing preserves bytes and upload progress; close releases its pending timer", {
  timeout: 5000,
}, async () => {
  const payload = Buffer.from(Array.from({ length: 32768 }, (_, i) => i % 251));
  const upstream = createServer((socket) => {
    socket.on("error", () => {});
    socket.write(payload);
    socket.once("data", () => upstream.emit("uploaded"));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gate = await createNetworkGate(upstream.address().port);
  gate.setDownloadRate(65536);
  let gateClosed = false;
  const client = createConnection(gate.port, "127.0.0.1");
  client.on("error", () => {});
  try {
    const chunks = [];
    const complete = new Promise((resolve) => {
      let bytes = 0;
      client.on("data", (chunk) => {
        chunks.push(chunk);
        bytes += chunk.length;
        if (bytes === payload.length) resolve();
      });
    });
    const start = performance.now();
    const uploaded = once(upstream, "uploaded");
    client.write("upload does not wait for the download");
    await uploaded;
    assert(gate.snapshot().downloadBytes < payload.length);
    await complete;
    assert.deepEqual(Buffer.concat(chunks), payload);
    assert(
      performance.now() - start >= 450,
      "32 KiB at 64 KiB/s must be paced",
    );
    assert.equal(gate.snapshot().pacedStreams, 0);

    // A second connection is deliberately too slow to complete; teardown must
    // clear the timer and settle the transform without waiting for its delay.
    gate.setDownloadRate(1);
    const pending = createConnection(gate.port, "127.0.0.1");
    pending.on("error", () => {});
    try {
      while (gate.snapshot().pacedStreams === 0)
        await new Promise((done) => setImmediate(done));
      const resumed = once(pending, "data");
      gate.setDownloadRate(0);
      assert((await resumed)[0].length > 0);
      gate.setDownloadRate(1);
      const closing = createConnection(gate.port, "127.0.0.1");
      closing.on("error", () => {});
      while (gate.snapshot().pacedStreams === 0)
        await new Promise((done) => setImmediate(done));
      await gate.close();
      gateClosed = true;
      assert.equal(gate.snapshot().pacedStreams, 0);
      assert.equal(gate.snapshot().sockets, 0);
    } finally {
      pending.destroy();
    }
  } finally {
    client.destroy();
    if (!gateClosed) await gate.close();
    await new Promise((done) => upstream.close(done));
  }
});
