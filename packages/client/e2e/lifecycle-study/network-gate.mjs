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
  let downloadRate = 0;
  let downloadBytes = 0;
  const paced = new Map();
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
        const pending = paced.get(stream);
        if (pending) {
          clearTimeout(pending.timer);
          pending.done();
        }
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
          let finished = false;
          const finish = (error, bytes) => {
            if (finished) return;
            finished = true;
            held.delete(stream);
            const pending = paced.get(stream);
            if (pending) clearTimeout(pending.timer);
            paced.delete(stream);
            done(error, bytes);
          };
          const forward = () => {
            if (stream.destroyed) return finish();
            if (fromClient || downloadRate === 0) {
              if (!fromClient) downloadBytes += chunk.length;
              return finish(null, chunk);
            }
            let offset = 0;
            const next = () => {
              if (stream.destroyed) return finish();
              if (downloadRate === 0) {
                downloadBytes += chunk.length - offset;
                return finish(null, chunk.subarray(offset));
              }
              const count = Math.min(4096, chunk.length - offset);
              const timer = setTimeout(
                () => {
                  paced.delete(stream);
                  if (stream.destroyed) return finish();
                  stream.push(chunk.subarray(offset, offset + count));
                  downloadBytes += count;
                  offset += count;
                  if (offset === chunk.length) finish();
                  else next();
                },
                Math.max(1, Math.ceil((count / downloadRate) * 1000)),
              );
              paced.set(stream, {
                timer,
                done: finish,
                resume: () => {
                  clearTimeout(timer);
                  paced.delete(stream);
                  next();
                },
              });
            };
            next();
          };
          if (fromClient) {
            clientBytes += chunk.length;
            if (cutAt !== undefined && clientBytes >= cutAt) {
              cutAt = undefined;
              cuts++;
              mode = "refuse";
              record({ type: "gate-upload-cut", clientBytes, cuts });
              for (const socket of sockets) socket.destroy();
              finish();
              return;
            }
          }
          if (mode === "silent") {
            stalledBytes += chunk.length;
            held.set(stream, { release: forward, done: finish });
          } else forward();
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
      downloadRate,
      downloadBytes,
      pacedStreams: paced.size,
      sockets: sockets.size,
    }),
    // Per downstream TCP connection. One held input chunk and timer per
    // transform; writable/readable backpressure bounds all subsequent bytes.
    setDownloadRate(bytesPerSecond) {
      if (!Number.isSafeInteger(bytesPerSecond) || bytesPerSecond < 0)
        throw new Error("Download rate must be a nonnegative integer");
      downloadRate = bytesPerSecond;
      for (const pending of [...paced.values()]) pending.resume();
      record({ type: "gate-download-rate", bytesPerSecond });
    },
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
        for (const { release } of waiting) release();
      }
    },
    disconnect() {
      record({ type: "gate-disconnect" });
      for (const socket of sockets) socket.destroy();
    },
    async close() {
      const closed = [...sockets].map(
        (socket) => new Promise((resolve) => socket.once("close", resolve)),
      );
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        ...closed,
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
      ]);
    },
  };
}
