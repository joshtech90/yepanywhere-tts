import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as sandbox from "../../src/session-sandbox.js";
import { proxyLoopbackVhost } from "../../src/artifacts/vhost-proxy.js";
import {
  ProjectServiceProcess,
  type ProjectServiceCommand,
} from "../../src/projects/ProjectServiceProcess.js";

const artifacts = resolve(import.meta.dirname, "../../../../.artifacts");
await mkdir(artifacts, { recursive: true });
const root = await realpath(
  await mkdtemp(join(artifacts, "project-service-process-")),
);
const stateRoot = join(root, "sandbox");
const prepare = sandbox.prepareSessionSandbox;
const available =
  (await sandbox.probeSessionSandboxAvailability({ stateRoot })).state ===
  "available";
afterAll(() => rm(root, { recursive: true }));

describe("project service process", { timeout: 20_000 }, () => {
  let service: ProjectServiceProcess | undefined;
  afterEach(async () => {
    await service?.stop();
    service = undefined;
    vi.restoreAllMocks();
  });

  async function fixture(): Promise<ProjectServiceCommand> {
    const projectPath = await mkdtemp(join(root, "project-"));
    await mkdir(join(projectPath, "app"));
    vi.spyOn(sandbox, "prepareSessionSandbox").mockImplementation((options) =>
      prepare({ ...options, stateRoot }),
    );
    return {
      projectPath,
      cwd: "app",
      argv: [process.execPath, "server.mjs"],
      portEnv: "PORT",
      readyPath: "/health",
      readyStatus: 200,
      startupTimeoutMs: 5000,
      stopGraceMs: 3000,
    };
  }

  it("refuses a missing sandbox instead of running the project on the host", async () => {
    const command = await fixture();
    vi.mocked(sandbox.prepareSessionSandbox).mockResolvedValue(undefined);
    service = new ProjectServiceProcess(command);
    await expect(service.start()).rejects.toThrow(
      "requires an enforced sandbox",
    );
    expect(service.state).toBe("failed");
    expect(service.brokerSocket).toBeUndefined();
  });

  it("rejects an escaping working directory before preparing a sandbox", async () => {
    const command = await fixture();
    command.cwd = "..";
    service = new ProjectServiceProcess(command);
    await expect(service.start()).rejects.toThrow("escapes project");
    expect(sandbox.prepareSessionSandbox).not.toHaveBeenCalled();
  });

  const native = available ? it : it.skip;
  native(
    "serves through its private broker, confines writes and stops the owned launch",
    async () => {
      const command = await fixture();
      const outside = join(root, "outside.txt");
      await writeFile(outside, "unchanged");
      await writeFile(
        join(command.projectPath, "app", "server.mjs"),
        `import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
let confined = false;
try { writeFileSync(${JSON.stringify(outside)}, 'escaped'); }
catch { confined = true; }
writeFileSync('inside.txt', 'allowed');
createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 201);
  res.end(JSON.stringify({ confined, cwd: process.cwd() }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`,
      );
      service = new ProjectServiceProcess(command);
      await service.start();
      expect(service.state).toBe("running");
      const socket = service.brokerSocket;
      expect(socket).toBeTruthy();
      const response = await proxyLoopbackVhost(
        new Request("http://service.invalid/value"),
        service.port,
        undefined,
        socket,
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        confined: true,
        cwd: join(command.projectPath, "app"),
      });
      expect(await readFile(outside, "utf8")).toBe("unchanged");
      expect(
        await readFile(join(command.projectPath, "app", "inside.txt"), "utf8"),
      ).toBe("allowed");
      await service.stop();
      expect(service.state).toBe("stopped");
      expect(service.brokerSocket).toBeUndefined();
      expect(
        (
          await proxyLoopbackVhost(
            new Request("http://service.invalid/"),
            service.port,
            undefined,
            socket,
          )
        ).status,
      ).toBe(502);
    },
  );
});
