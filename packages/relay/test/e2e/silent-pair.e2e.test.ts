/**
 * A server learns that its waiting connection was claimed only from the
 * client's first frame. A client that pairs and then says nothing would leave
 * the server believing it is still waiting while every other client is told
 * server_offline. The relay closes such pairs so the server re-registers.
 */

import { randomUUID } from "node:crypto";
import {
  type RelayServerRegister,
  isRelayServerRegistered,
} from "@yep-anywhere/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { SILENT_PAIR_CLOSE_REASON } from "../../src/connections.js";
import { type RelayServer, createRelayServer } from "../../src/server.js";

const TIMEOUT_MS = 300;

describe("Silent pair release E2E", () => {
  let relay: RelayServer;
  let wsBase: string;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    relay = await createRelayServer({
      inMemoryDb: true,
      logLevel: "warn",
      disablePrettyPrint: true,
      disableTelemetry: true,
      pairFirstMessageTimeoutMs: TIMEOUT_MS,
    });
    wsBase = `ws://localhost:${relay.port}`;
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.terminate();
  });

  afterAll(async () => {
    await relay.close();
  });

  /** Open a socket with a message queue attached before the first frame. */
  function open(path: "/ws" | "/mux") {
    const ws = new WebSocket(`${wsBase}${path}`);
    sockets.push(ws);
    const queue: Record<string, unknown>[] = [];
    const waiters: (() => void)[] = [];
    ws.on("message", (data, isBinary) => {
      queue.push(isBinary ? { binary: true } : JSON.parse(String(data)));
      for (const wake of waiters.splice(0)) wake();
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString() }),
      ),
    );
    const next = async () => {
      while (queue.length === 0) {
        await new Promise<void>((wake) => waiters.push(wake));
      }
      return queue.shift() as Record<string, unknown>;
    };
    const opened = new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return { ws, next, closed, opened };
  }

  async function registerHost(username: string) {
    const host = open("/ws");
    await host.opened;
    host.ws.send(
      JSON.stringify({
        type: "server_register",
        username,
        installId,
      } satisfies RelayServerRegister),
    );
    expect(isRelayServerRegistered(await host.next())).toBe(true);
    return host;
  }

  async function claim(username: string) {
    const client = open("/ws");
    await client.opened;
    client.ws.send(JSON.stringify({ type: "client_connect", username }));
    return { ...client, reply: await client.next() };
  }

  const installId = randomUUID();

  it("releases the server when a /ws client pairs and stays silent", async () => {
    const username = `silent-ws-${randomUUID().slice(0, 8)}`;
    const host = await registerHost(username);
    const silent = await claim(username);
    expect(silent.reply).toEqual({ type: "client_connected" });

    // Until the timeout the server is unreachable, as in the incident.
    const blocked = await claim(username);
    expect(blocked.reply).toMatchObject({ reason: "server_offline" });

    expect(await silent.closed).toEqual({
      code: 1000,
      reason: SILENT_PAIR_CLOSE_REASON,
    });
    expect((await host.closed).reason).toBe("Peer disconnected");

    await registerHost(username);
    expect((await claim(username)).reply).toEqual({ type: "client_connected" });
  });

  it("releases the server when a mux circuit opens and stays silent", async () => {
    const username = `silent-mux-${randomUUID().slice(0, 8)}`;
    const host = await registerHost(username);
    const mux = open("/mux");
    expect(await mux.next()).toMatchObject({ type: "mux_ready" });
    mux.ws.send(
      JSON.stringify({
        type: "mux_open",
        circuitId: 1,
        username,
        channel: "app",
      }),
    );
    expect(await mux.next()).toEqual({ type: "mux_opened", circuitId: 1 });

    expect(await mux.next()).toMatchObject({
      type: "mux_closed",
      circuitId: 1,
    });
    expect((await host.closed).reason).toBe("Peer disconnected");
    expect(mux.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("keeps a pair whose client speaks before the timeout", async () => {
    const username = `talking-${randomUUID().slice(0, 8)}`;
    const host = await registerHost(username);
    const client = await claim(username);
    client.ws.send(JSON.stringify({ type: "srp_hello" }));
    expect(await host.next()).toEqual({ type: "srp_hello" });

    await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS * 2));
    client.ws.send(JSON.stringify({ type: "still_here" }));
    expect(await host.next()).toEqual({ type: "still_here" });
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });
});
