import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSandboxEnforcement } from "@yep-anywhere/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";
import {
  createSessionAppRoutes,
  sessionAppBrokerSocket,
} from "../../src/routes/sessionApps.js";
import {
  prepareSessionSandbox,
  probeSessionSandboxAvailability,
  sandboxPortBrokerSocketPath,
} from "../../src/session-sandbox.js";
import type { Process } from "../../src/supervisor/Process.js";

const probeStateRoot = await mkdtemp(join(tmpdir(), "ya-sandbox-probe-"));
afterAll(() => rm(probeStateRoot, { recursive: true }));
const hostSandboxAvailable =
  (await probeSessionSandboxAvailability({ stateRoot: probeStateRoot }))
    .state === "available";
const t = hostSandboxAvailable ? it : it.skip;

const firewalled: SessionSandboxEnforcement = {
  requested: "project-write",
  effective: "project-write",
  state: "enforced",
  hostBackend: "bubblewrap:bwrap",
  networkFirewall: true,
};

function fakeProcess(
  pid: number | undefined,
  sandboxEnforcement: SessionSandboxEnforcement | undefined,
): Process {
  return { pid, sandboxEnforcement } as unknown as Process;
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Real-sandbox launches: see the timing note in session-sandbox.test.ts.
describe("sandboxed session apps", { timeout: 20_000 }, () => {
  const roots: string[] = [];
  const children: ChildProcess[] = [];
  afterEach(async () => {
    for (const child of children.splice(0)) child.kill("SIGTERM");
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true })),
    );
  });

  async function artifactServer(root: string): Promise<ArtifactServer> {
    const server = new ArtifactServer(
      // No public origin, so nothing listens on this port.
      { port: 3400, localOrigin: "http://artifacts.localhost:3400" },
      createLocalResourcePathPolicy({ allowedPaths: [root] }),
      { stateDir: join(root, "artifacts") },
    );
    await server.ready;
    return server;
  }

  t(
    "serves a sandbox loopback server under a minted private name",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "ya-session-apps-"));
      roots.push(root);
      const projectPath = join(root, "project");
      await mkdir(projectPath);
      const runtime = await prepareSessionSandbox({
        level: "project-write",
        provider: "claude",
        projectPath,
        stateKey: "session-app-test",
        stateRoot: join(root, "state"),
      });
      if (!runtime) throw new Error("sandbox runtime was not prepared");
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      const server = `require("http").createServer((q, s) => s.end("app:" + q.url)).listen(${port}, "127.0.0.1", () => console.log("ready"))`;
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
      const pid = child.pid;
      await waitFor(() => stdout.includes("ready"), "the sandboxed server");
      await waitFor(
        () => existsSync(sandboxPortBrokerSocketPath(pid)),
        "the port broker",
      );

      let live = true;
      const processForSession = () =>
        live ? fakeProcess(pid, firewalled) : undefined;
      const artifacts = await artifactServer(root);
      artifacts.setSessionAppUpstream(() =>
        sessionAppBrokerSocket(processForSession()),
      );
      const routes = createSessionAppRoutes({
        getArtifactServer: () => artifacts,
        getProcessForSession: processForSession,
      });
      const minted = await routes.request(
        "/projects/p/sessions/s1/sandbox-apps",
        { method: "POST", body: JSON.stringify({ port }) },
      );
      expect(minted.status).toBe(200);
      const { name, accessToken } = (await minted.json()) as {
        name: string;
        accessToken: string;
      };
      expect(name).toMatch(/^sbx-[0-9a-f]{16}$/);
      // The same session and port reuse one name.
      const again = await routes.request(
        "/projects/p/sessions/s1/sandbox-apps",
        {
          method: "POST",
          body: JSON.stringify({ port }),
        },
      );
      expect(((await again.json()) as { name: string }).name).toBe(name);

      const host = `${name}.localhost:3400`;
      const unauthorized = await artifacts.dispatchHost(
        new Request(`http://${host}/page`, { headers: { host } }),
      );
      expect(unauthorized?.status).toBe(401);

      const served = await artifacts.dispatchHost(
        new Request(`http://${host}/page?ya_access=${accessToken}`, {
          headers: { host },
        }),
      );
      expect(served?.status).toBe(200);
      expect(await served?.text()).toBe("app:/page");

      // Once the session's sandbox is gone the name answers, but with nothing.
      live = false;
      const stopped = await artifacts.dispatchHost(
        new Request(`http://${host}/page?ya_access=${accessToken}`, {
          headers: { host },
        }),
      );
      expect(stopped?.status).toBe(503);
    },
  );

  it("refuses a session that has no firewalled sandbox broker", async () => {
    const root = await mkdtemp(join(tmpdir(), "ya-session-apps-"));
    roots.push(root);
    const artifacts = await artifactServer(root);
    for (const process of [
      undefined,
      fakeProcess(123, undefined),
      fakeProcess(123, { ...firewalled, networkFirewall: false }),
      // Firewalled, but no broker socket exists for this pid.
      fakeProcess(2_000_000_000, firewalled),
    ]) {
      const routes = createSessionAppRoutes({
        getArtifactServer: () => artifacts,
        getProcessForSession: () => process,
      });
      const response = await routes.request(
        "/projects/p/sessions/s1/sandbox-apps",
        { method: "POST", body: JSON.stringify({ port: 8080 }) },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        reason: "no-sandbox-broker",
      });
    }
    const routes = createSessionAppRoutes({
      getArtifactServer: () => artifacts,
      getProcessForSession: () => undefined,
    });
    for (const port of [0, 70_000, "80", 1.5]) {
      const response = await routes.request(
        "/projects/p/sessions/s1/sandbox-apps",
        { method: "POST", body: JSON.stringify({ port }) },
      );
      expect(response.status).toBe(400);
    }
  });
});
