import { createConnection, createServer } from "node:net";
import { Transform } from "node:stream";

/** TCP-only fault control: preserves the real WebSocket, SRP and relay protocols. */
export async function createNetworkGate(targetPort, record = () => {}) {
  let mode = "pass";
  let accepted = 0;
  let refused = 0;
  let stalledBytes = 0;
  let clientBytes = 0;
  let cutAt;
  let cuts = 0;
  // One blocked chunk per direction; Transform backpressure bounds the rest.
  const held = new Map();
  const sockets = new Set(); // Removed on close; close() destroys every owner.
  const server = createServer((client) => {
    if (mode === "refuse") {
      refused++;
      record({ type: "gate-refused", refused });
      client.destroy();
      return;
    }
    accepted++;
    const upstream = createConnection({ host: "127.0.0.1", port: targetPort });
    const filters = [];
    const dispose = () => {
      client.destroy();
      upstream.destroy();
      for (const stream of filters) {
        const waiting = held.get(stream);
        held.delete(stream);
        stream.destroy();
        waiting?.done();
      }
    };
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("error", dispose);
      socket.on("close", () => {
        sockets.delete(socket);
        dispose();
      });
    }
    const filter = (fromClient = false) => {
      const stream = new Transform({
        transform(chunk, _encoding, done) {
          if (fromClient) {
            clientBytes += chunk.length;
            if (cutAt !== undefined && clientBytes >= cutAt) {
              cutAt = undefined;
              cuts++;
              mode = "refuse";
              record({ type: "gate-upload-cut", clientBytes, cuts });
              for (const socket of sockets) socket.destroy();
              done();
              return;
            }
          }
          if (mode === "silent") {
            stalledBytes += chunk.length;
            held.set(stream, { chunk, done });
          } else done(null, chunk);
        },
      });
      filters.push(stream);
      return stream;
    };
    client.pipe(filter(true)).pipe(upstream);
    upstream.pipe(filter()).pipe(client);
    record({ type: "gate-accepted", accepted });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    snapshot: () => ({
      mode,
      accepted,
      refused,
      stalledBytes,
      clientBytes,
      cuts,
      sockets: sockets.size,
    }),
    refuseAfterClientBytes(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes <= 0)
        throw new Error("A positive byte count is required");
      cutAt = clientBytes + bytes;
    },
    setMode(next) {
      if (!["pass", "refuse", "silent"].includes(next))
        throw new Error(`Unknown gate mode: ${next}`);
      mode = next;
      record({ type: "gate-mode", mode });
      if (mode === "refuse") for (const socket of sockets) socket.destroy();
      if (mode === "pass") {
        const waiting = [...held.values()];
        held.clear();
        for (const { chunk, done } of waiting) done(null, chunk);
      }
    },
    disconnect() {
      record({ type: "gate-disconnect" });
      for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
