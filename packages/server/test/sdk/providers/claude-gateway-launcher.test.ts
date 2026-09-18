import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeGatewayLauncher,
  interpretServiceCommand,
  isClaudeGatewayLoopbackUrl,
  resolveClaudeGatewayEndpoint,
} from "../../../src/sdk/providers/claude-gateway-launcher.js";

async function listenOn(host: string): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected an ephemeral TCP port");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function fakeChild(pid = 1234): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  });
  return child;
}

/**
 * A command that answers `status` immediately, like a service script. Without
 * this the launcher waits out its status probe before every launch, which is
 * exactly the behavior the probe timeout exists to bound.
 */
function serviceScriptSpawn(
  onLaunch: (command: string) => ChildProcess,
  statusExitCode = 3,
): (command: string) => ChildProcess {
  return (command: string) => {
    if (command.endsWith(" status")) {
      const child = fakeChild();
      queueMicrotask(() => child.emit("close", statusExitCode, null));
      return child;
    }
    return onLaunch(command);
  };
}

describe("interpretServiceCommand", () => {
  it("reads a trailing start verb as a declaration that verbs are supported", () => {
    expect(interpretServiceCommand("~/vllm/service-model start")).toEqual({
      command: "~/vllm/service-model",
      style: "verbs",
    });
  });

  it("leaves a plain command to be probed", () => {
    expect(interpretServiceCommand("  copilot-api --port 4141  ")).toEqual({
      command: "copilot-api --port 4141",
      style: "unknown",
    });
  });

  it("treats an empty command as absent", () => {
    expect(interpretServiceCommand("   ")).toEqual({
      command: undefined,
      style: "unknown",
    });
  });
});

describe("ClaudeGatewayLauncher", () => {
  it.each([
    "http://localhost:4141",
    "http://localhost.:4141",
    "http://127.0.0.1:4141",
    "http://127.99.2.3:4141",
    "http://[::1]:4141",
  ])("recognizes loopback URL %s", (url) => {
    expect(isClaudeGatewayLoopbackUrl(url)).toBe(true);
  });

  it.each([
    "http://example.com:4141",
    "http://10.0.0.1:4141",
    "http://[::2]:4141",
    "ftp://localhost:4141",
    "not a URL",
  ])("rejects non-loopback URL %s", (url) => {
    expect(isClaudeGatewayLoopbackUrl(url)).toBe(false);
  });

  it("detects a real IPv4 loopback TCP listener", async () => {
    const server = await listenOn("127.0.0.1");
    try {
      await expect(
        resolveClaudeGatewayEndpoint(`http://127.0.0.1:${server.port}`),
      ).resolves.toBe(`http://127.0.0.1:${server.port}`);
    } finally {
      await server.close();
    }
  });

  it("resolves an unreachable loopback endpoint to null", async () => {
    const server = await listenOn("127.0.0.1");
    const port = server.port;
    await server.close();

    await expect(
      resolveClaudeGatewayEndpoint(`http://127.0.0.1:${port}`),
    ).resolves.toBeNull();
  });

  // A one-family bind leaves the other family's socket free on the same port,
  // so `localhost` can front two unrelated gateways. Pin to the one answering.
  it("pins localhost to the address family that answers", async () => {
    let server: Awaited<ReturnType<typeof listenOn>>;
    try {
      server = await listenOn("::1");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") return;
      throw error;
    }

    try {
      await expect(
        resolveClaudeGatewayEndpoint(`http://localhost:${server.port}`),
      ).resolves.toBe(`http://[::1]:${server.port}`);
    } finally {
      await server.close();
    }
  });

  it("does not launch when the endpoint already has a listener", async () => {
    const spawnCommand = vi.fn(() => fakeChild());
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => "http://[::1]:4141"),
      spawnCommand,
    });

    await expect(
      launcher.ensureReady({
        url: "http://localhost:4141",
        startCommand: "gateway start",
      }),
    ).resolves.toBe("http://[::1]:4141");
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it("resolves a listening endpoint with no start command configured", async () => {
    const spawnCommand = vi.fn(() => fakeChild());
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => "http://127.0.0.1:4141"),
      spawnCommand,
    });

    await expect(
      launcher.ensureReady({ url: "http://localhost:4141" }),
    ).resolves.toBe("http://127.0.0.1:4141");
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it("never launches a command for a non-loopback endpoint", async () => {
    const probe = vi.fn(async () => null);
    const spawnCommand = vi.fn(() => fakeChild());
    const launcher = new ClaudeGatewayLauncher({ probe, spawnCommand });

    await expect(
      launcher.ensureReady({
        url: "https://gateway.example.com",
        startCommand: "gateway start",
      }),
    ).resolves.toBeNull();
    expect(probe).not.toHaveBeenCalled();
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it("coalesces concurrent launch attempts until readiness", async () => {
    let listening: string | null = null;
    const child = fakeChild();
    const probe = vi.fn(async () => listening);
    const launches: string[] = [];
    const spawnCommand = vi.fn(
      serviceScriptSpawn((command) => {
        launches.push(command);
        listening = "http://127.0.0.1:4141";
        return child;
      }),
    );
    const signalChild = vi.fn((target: ChildProcess) => {
      target.emit("close", 0, null);
    });
    const launcher = new ClaudeGatewayLauncher({
      probe,
      spawnCommand,
      signalChild,
    });
    const config = {
      url: "http://127.0.0.1:4141",
      startCommand: "gateway start",
    };

    await expect(
      Promise.all([launcher.ensureReady(config), launcher.ensureReady(config)]),
    ).resolves.toEqual(["http://127.0.0.1:4141", "http://127.0.0.1:4141"]);
    expect(launches).toEqual(["gateway start"]);

    await launcher.shutdown();
    expect(signalChild).toHaveBeenCalledWith(child, "SIGTERM");
  });

  it("kills a command that never opens the endpoint", async () => {
    let now = 0;
    const child = fakeChild();
    const signalChild = vi.fn((target: ChildProcess) => {
      target.emit("close", null, "SIGTERM");
    });
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => null),
      spawnCommand: vi.fn(serviceScriptSpawn(() => child, 0)),
      signalChild,
      now: () => now,
      delay: async (milliseconds) => {
        now += milliseconds;
      },
      readinessTimeoutMs: 200,
      readinessPollMs: 100,
    });

    await expect(
      launcher.ensureReady({
        url: "http://[::1]:4141",
        startCommand: "gateway start",
      }),
    ).resolves.toBeNull();
    expect(signalChild).toHaveBeenCalledWith(child, "SIGTERM");
  });

  it("launches the bare command when status keeps running", async () => {
    // A command that ignores `status` and keeps serving is the server itself.
    let listening: string | null = null;
    const statusChild = fakeChild(4242);
    const serverChild = fakeChild(4343);
    const commands: string[] = [];
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => listening),
      spawnCommand: vi.fn((command: string) => {
        commands.push(command);
        if (command.endsWith(" status")) return statusChild;
        listening = "http://127.0.0.1:4141";
        return serverChild;
      }),
      signalChild: vi.fn((target: ChildProcess) => {
        target.emit("close", null, "SIGTERM");
      }),
      statusProbeTimeoutMs: 10,
    });

    await expect(
      launcher.ensureReady({
        url: "http://127.0.0.1:4141",
        startCommand: "serve-model",
      }),
    ).resolves.toBe("http://127.0.0.1:4141");
    expect(commands).toEqual(["serve-model status", "serve-model"]);
  });

  it("uses only the start verb when status answers cleanly", async () => {
    let listening: string | null = null;
    const commands: string[] = [];
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => listening),
      spawnCommand: vi.fn((command: string) => {
        commands.push(command);
        const child = fakeChild();
        if (command.endsWith(" status")) {
          queueMicrotask(() => child.emit("close", 0, null));
          return child;
        }
        listening = "http://127.0.0.1:8001";
        queueMicrotask(() => child.emit("close", 0, null));
        return child;
      }),
      statusProbeTimeoutMs: 10,
    });

    await expect(
      launcher.ensureReady({
        url: "http://127.0.0.1:8001",
        startCommand: "service-model",
      }),
    ).resolves.toBe("http://127.0.0.1:8001");
    expect(commands).toEqual(["service-model status", "service-model start"]);
  });

  it("asks the command to stop and leaves a freed port alone", async () => {
    let listening: string | null = "http://127.0.0.1:8001";
    const commands: string[] = [];
    const stopListener = vi.fn(async () => true);
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => listening),
      spawnCommand: vi.fn((command: string) => {
        commands.push(command);
        const child = fakeChild();
        queueMicrotask(() => {
          if (command.endsWith(" stop")) listening = null;
          child.emit("close", 0, null);
        });
        return child;
      }),
      stopListener,
      stopVerifyDelayMs: 1,
      statusProbeTimeoutMs: 10,
    });

    await launcher.configure({
      url: "http://127.0.0.1:8001",
      startCommand: "service-model",
    });
    await launcher.stopService();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(commands).toEqual(["service-model stop"]);
    expect(stopListener).not.toHaveBeenCalled();
  });

  it("signals the listener when a stop request leaves the port open", async () => {
    const stopListener = vi.fn(async () => true);
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => "http://127.0.0.1:8001"),
      spawnCommand: vi.fn(() => {
        const child = fakeChild();
        // An unrecognized `stop` argument: usage, nonzero, port untouched.
        queueMicrotask(() => child.emit("close", 2, null));
        return child;
      }),
      stopListener,
      stopVerifyDelayMs: 1,
      statusProbeTimeoutMs: 10,
    });

    await launcher.configure({
      url: "http://127.0.0.1:8001",
      startCommand: "serve-model",
    });
    await launcher.stopService();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stopListener).toHaveBeenCalledWith(8001);
  });

  it("never stops a service it was not asked to manage", async () => {
    const stopListener = vi.fn(async () => true);
    const spawnCommand = vi.fn(() => fakeChild());
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => "http://127.0.0.1:8001"),
      spawnCommand,
      stopListener,
      stopVerifyDelayMs: 1,
    });

    await launcher.configure({ url: "http://127.0.0.1:8001" });
    await launcher.stopService();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(spawnCommand).not.toHaveBeenCalled();
    expect(stopListener).not.toHaveBeenCalled();
  });

  it("terminates an owned child when configuration changes", async () => {
    let listening: string | null = null;
    const child = fakeChild();
    const signalChild = vi.fn((target: ChildProcess) => {
      target.emit("close", 0, "SIGTERM");
    });
    const launcher = new ClaudeGatewayLauncher({
      probe: vi.fn(async () => listening),
      spawnCommand: vi.fn(
        serviceScriptSpawn(() => {
          listening = "http://127.0.0.1:4141";
          return child;
        }),
      ),
      signalChild,
    });

    await launcher.ensureReady({
      url: "http://localhost:4141",
      startCommand: "gateway start",
    });
    await launcher.configure({
      url: "http://localhost:4041",
      startCommand: "gateway start --port 4041",
    });

    expect(signalChild).toHaveBeenCalledWith(child, "SIGTERM");
  });
});
