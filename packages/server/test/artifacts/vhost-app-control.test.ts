import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  VhostAppControl,
  vhostAppControlAvailable,
} from "../../src/artifacts/VhostAppControl.js";
import { createVhostAppRoutes } from "../../src/routes/vhostApps.js";

const children: ChildProcess[] = [];
async function app(port = 0, cleanupMs = 0) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `if (${cleanupMs} > 0) process.once('SIGTERM', () => setTimeout(() => process.exit(0), ${cleanupMs}));
       require('node:net').createServer().listen(${port}, '127.0.0.1', function() { process.stdout.write(String(this.address().port)+'\\n'); });`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
  const [data] = await once(child.stdout!, "data");
  return { child, port: Number(String(data).trim()) };
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});

describe.skipIf(!vhostAppControlAvailable)(
  "configured app process control",
  () => {
    it("identifies and stops the real listener through the route", async () => {
      const { child, port } = await app();
      const routes = createVhostAppRoutes(
        new VhostAppControl(() => [{ name: "review", port }]),
      );
      const response = await routes.request(
        "/artifacts/vhosts/review/listener",
      );
      expect(response.status).toBe(200);
      const { token } = await response.json();
      expect(token).toBeTypeOf("string");
      const stopped = await routes.request("/artifacts/vhosts/review/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      expect(stopped.status).toBe(200);
      expect(child.signalCode).toBe("SIGTERM");
      expect(
        await (
          await routes.request("/artifacts/vhosts/review/listener")
        ).json(),
      ).toEqual({ token: null });
    });
    it("allows a listener more than 1.5 seconds for SIGTERM cleanup", async () => {
      const { child, port } = await app(0, 2000);
      const control = new VhostAppControl(() => [{ name: "review", port }]);
      const { token } = await control.identify("review");
      await control.stop("review", token);
      expect(child.exitCode).toBe(0);
      expect(await control.identify("review")).toEqual({ token: null });
    }, 10000);
    it("rejects a replacement listener instead of killing a reused port", async () => {
      const first = await app();
      const control = new VhostAppControl(() => [
        { name: "review", port: first.port },
      ]);
      const { token } = await control.identify("review");
      const exited = once(first.child, "exit");
      first.child.kill("SIGTERM");
      await exited;
      const replacement = await app(first.port);
      await expect(control.stop("review", token)).rejects.toThrow(
        "listener changed",
      );
      expect(replacement.child.exitCode).toBeNull();
      expect(replacement.child.signalCode).toBeNull();
    });
    it("refuses YA itself and unconfigured names", async () => {
      const server = createServer();
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = (server.address() as { port: number }).port;
      const control = new VhostAppControl(() => [{ name: "self", port }]);
      try {
        await expect(control.identify("self")).rejects.toThrow(
          "Refusing to stop YA",
        );
        await expect(control.identify("unknown")).rejects.toThrow(
          "no longer configured",
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  },
);
