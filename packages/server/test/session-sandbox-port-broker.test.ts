import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo, connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  prepareSessionSandbox,
  probeSessionSandboxAvailability,
  sandboxPortBrokerSocketPath,
} from "../src/session-sandbox.js";

const probeStateRoot = await mkdtemp(join(tmpdir(), "ya-sandbox-probe-"));
afterAll(() => rm(probeStateRoot, { recursive: true }));
const hostSandboxAvailable =
  (await probeSessionSandboxAvailability({ stateRoot: probeStateRoot }))
    .state === "available";
const t = hostSandboxAvailable ? it : it.skip;

/** Send raw bytes through a Unix socket and collect everything returned. */
function exchange(socketPath: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString("utf8");
    });
    socket.once("error", reject);
    socket.once("close", () => resolve(received));
    socket.write(payload);
  });
}

function hostConnects(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// The broker splices whatever loopback it runs in, so the host's will do.
describe("session sandbox port broker splice", { timeout: 20_000 }, () => {
  it("delivers a large reply whose upstream closes right after writing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "ya-port-broker-splice-"));
    const socketPath = join(root, "broker.sock");
    // Small enough to arrive whole, with its close, before the reader drains;
    // an odd size leaves a partial chunk queued (an exact 256 KiB did not).
    const body = Buffer.alloc(250_000, 0x61);
    const upstream = createServer((socket) =>
      socket.once("data", () => socket.end(body)),
    );
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const broker = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("../src/session-sandbox-port-broker.mjs", import.meta.url),
        ),
        socketPath,
      ],
      { stdio: ["pipe", "ignore", "inherit"] },
    );
    try {
      await waitFor(() => existsSync(socketPath), "the port broker socket");
      const { port } = upstream.address() as AddressInfo;
      const received = await new Promise<number>((resolve, reject) => {
        const socket = connect(socketPath);
        let total = 0;
        // Read only after the upstream has written everything and closed, so
        // the reply is still buffered in the broker when its upstream closes.
        socket.pause();
        setTimeout(() => socket.resume(), 300);
        socket.on("data", (chunk) => {
          total += chunk.length;
        });
        socket.once("error", reject);
        socket.once("close", () => resolve(total));
        socket.write(`${port}\nGET / HTTP/1.0\r\n\r\n`);
      });
      expect(received).toBe(body.length);
    } finally {
      broker.kill("SIGTERM");
      upstream.close();
      await rm(root, { recursive: true });
    }
  });
});

// Real-sandbox launches: see the timing note in session-sandbox.test.ts.
describe("session sandbox port broker", { timeout: 20_000 }, () => {
  const roots: string[] = [];
  const children: ChildProcess[] = [];
  afterEach(async () => {
    for (const child of children.splice(0)) child.kill("SIGTERM");
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true })),
    );
  });

  t(
    "reaches a loopback server in a firewalled sandbox, and nothing else",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "ya-port-broker-"));
      roots.push(root);
      const projectPath = join(root, "project");
      await mkdir(projectPath);
      const runtime = await prepareSessionSandbox({
        level: "project-write",
        provider: "claude",
        projectPath,
        stateKey: "broker-test",
        stateRoot: join(root, "state"),
      });
      if (!runtime) throw new Error("sandbox runtime was not prepared");
      expect(runtime.enforcement.networkFirewall).toBe(true);

      // A port the host is not using, so a host connection proves nothing leaks.
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      expect(await hostConnects(port)).toBe(false);
      const server = `require("http").createServer((q, s) => s.end("inside:" + q.url)).listen(${port}, "127.0.0.1", () => console.log("ready"))`;
      const spawned = runtime.wrapSpawn(process.execPath, ["-e", server], {
        ...process.env,
      });
      const child = (() => {
        try {
          return spawn(spawned.command, spawned.args, {
            cwd: spawned.cwd,
            env: spawned.env,
            stdio: spawned.stdio,
          });
        } finally {
          spawned.release();
        }
      })();
      children.push(child);
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      if (!child.pid) throw new Error("sandbox child has no pid");
      const socketPath = sandboxPortBrokerSocketPath(child.pid);
      await waitFor(() => stdout.includes("ready"), "the sandboxed server");
      await waitFor(() => existsSync(socketPath), "the port broker socket");

      // The server is bound to the sandbox's own loopback: the host cannot see it.
      expect(await hostConnects(port)).toBe(false);
      const response = await exchange(
        socketPath,
        `${port}\nGET /hello HTTP/1.0\r\nHost: sandbox\r\n\r\n`,
      );
      expect(response).toMatch(/^HTTP\/1\.[01] 200/);
      expect(response).toContain("inside:/hello");

      // A malformed port line gets nothing, not a connection somewhere.
      expect(await exchange(socketPath, "not-a-port\nGET /\r\n\r\n")).toBe("");
      expect(await exchange(socketPath, "70000\n")).toBe("");

      // Another sandbox cannot reach this broker: host /tmp, which holds every
      // broker socket, is replaced by each sandbox's private /tmp.
      const other = runtime.wrapSpawn(
        "/bin/sh",
        ["-c", 'test ! -e "$BROKER_SOCKET"'],
        { ...process.env, BROKER_SOCKET: socketPath },
      );
      const otherExit = await new Promise<number | null>((resolve, reject) => {
        const probe = (() => {
          try {
            return spawn(other.command, other.args, {
              cwd: other.cwd,
              env: other.env,
              stdio: other.stdio,
            });
          } finally {
            other.release();
          }
        })();
        probe.once("error", reject);
        probe.once("exit", resolve);
      });
      expect(otherExit).toBe(0);

      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      await waitFor(() => !existsSync(socketPath), "broker socket removal");
    },
  );
});
