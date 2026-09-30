#!/usr/bin/env node

/**
 * The one way into a firewalled session sandbox's loopback.
 *
 * The network launcher starts this inside the sandbox's user and network
 * namespaces, but outside Bubblewrap's filesystem and process sandbox, so the
 * agent can neither see nor signal it. It listens on a Unix socket in a host
 * temp directory that every sandbox replaces with its own private /tmp, so
 * only the YA server reaches it. Each connection names one TCP port on its
 * first line and is then spliced to 127.0.0.1:<port> inside the namespace:
 * a server the session started on loopback is reachable without opening any
 * host port or relaxing the firewall. topics/session-sandbox-network-boundary.md
 */

import { chmodSync, unlinkSync } from "node:fs";
import { connect, createServer } from "node:net";

const MAX_CONNECTIONS = 64;
const PORT_LINE_MAX_BYTES = 8;
const PORT_LINE_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 10 * 60_000;

const socketPath = process.argv[2];
if (!socketPath?.startsWith("/")) {
  console.error("[session-sandbox-port-broker] usage: <absolute socket path>");
  process.exit(2);
}

function removeSocket() {
  try {
    unlinkSync(socketPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function parsePort(line) {
  if (!/^[0-9]{1,5}$/.test(line)) return null;
  const port = Number(line);
  return port >= 1 && port <= 65535 ? port : null;
}

const server = createServer({ allowHalfOpen: false }, (client) => {
  let buffered = Buffer.alloc(0);
  const portLineTimer = setTimeout(
    () => client.destroy(),
    PORT_LINE_TIMEOUT_MS,
  );
  client.on("error", () => client.destroy());
  const onData = (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    const newline = buffered.indexOf(0x0a);
    if (newline === -1) {
      if (buffered.length > PORT_LINE_MAX_BYTES) client.destroy();
      return;
    }
    client.off("data", onData);
    clearTimeout(portLineTimer);
    const port = parsePort(buffered.subarray(0, newline).toString("ascii"));
    if (port === null) {
      client.destroy();
      return;
    }
    const rest = buffered.subarray(newline + 1);
    client.pause();
    const upstream = connect({ host: "127.0.0.1", port });
    upstream.on("error", () => {
      upstream.destroy();
      client.destroy();
    });
    upstream.once("connect", () => {
      if (rest.length > 0) upstream.write(rest);
      for (const socket of [client, upstream]) {
        socket.setTimeout(IDLE_TIMEOUT_MS, () => {
          client.destroy();
          upstream.destroy();
        });
      }
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
    client.once("close", () => upstream.destroy());
    upstream.once("close", () => client.destroy());
  };
  client.on("data", onData);
});
server.maxConnections = MAX_CONNECTIONS;

function shutdown() {
  server.close();
  removeSocket();
  process.exit(0);
}

// The launcher holds our stdin; its exit, however abrupt, ends us.
process.stdin.on("end", shutdown);
process.stdin.on("error", shutdown);
process.stdin.resume();
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

removeSocket();
server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
});
server.on("error", (error) => {
  console.error(`[session-sandbox-port-broker] ${error.message}`);
  removeSocket();
  process.exit(1);
});
