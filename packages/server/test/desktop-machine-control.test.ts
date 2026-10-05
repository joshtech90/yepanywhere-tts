import { createServer, createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopBootstrapService,
  DESKTOP_SESSION_COOKIE_NAME,
} from "../src/desktop/DesktopBootstrapService.js";
import {
  NativeMachineControl,
  desktopControlOrigin,
  isDesktopControlOrigin,
} from "../src/desktop/machine-control.js";
import { createAuthMiddleware } from "../src/middleware/auth.js";
import { PRINCIPAL_VARIABLE } from "../src/auth/principal.js";
import type { AuthService } from "../src/auth/AuthService.js";
import { startMachineControlSession } from "../src/sdk/providers/machine-control.js";
import type {
  AgentSession,
  StartSessionOptions,
} from "../src/sdk/providers/types.js";

async function proof({
  cookie = true,
  disabled = false,
  open = false,
  limited = false,
} = {}) {
  const bootstrap = new DesktopBootstrapService({
    masterSecret: "a".repeat(64),
  });
  const code = bootstrap.mintCode();
  const session = bootstrap.consumeCode(code.code);
  let origin: ReturnType<typeof desktopControlOrigin>;
  const app = new Hono();
  app.use(
    "*",
    createAuthMiddleware({
      authService: {
        isLocalhostOpen: () => open,
        isEnabled: () => false,
      } as AuthService,
      authDisabled: disabled,
      desktopBootstrapService: bootstrap,
    }),
  );
  app.get("/launch", (c) => {
    c.set(PRINCIPAL_VARIABLE, { kind: limited ? "limited" : "superuser" });
    origin = desktopControlOrigin(c);
    return c.json({ accepted: true });
  });
  await app.request("/launch", {
    headers: cookie
      ? { cookie: `${DESKTOP_SESSION_COOKIE_NAME}=${session}` }
      : {},
  });
  return origin;
}

describe("native desktop launch provenance", () => {
  it("requires actual owner credentials, not permissive auth, a token-shaped object or persisted provenance", async () => {
    const origin = await proof();
    expect(isDesktopControlOrigin(origin)).toBe(true);
    expect(JSON.stringify(origin)).toBe("{}");
    expect(isDesktopControlOrigin(JSON.parse(JSON.stringify(origin)))).toBe(
      false,
    );
    expect(isDesktopControlOrigin({ launch: "copied-label" })).toBe(false);
    for (const options of [
      { cookie: false },
      { disabled: true },
      { open: true },
      { limited: true },
    ])
      expect(await proof(options)).toBeUndefined();
  });
  it("registers an actual live provider, unregisters before abort and rejects a lost native channel", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ya-mc-ts-"));
    const path = join(directory, "server.sock");
    const requests: Record<string, unknown>[] = [];
    let enabled = true;
    let socket: import("node:net").Socket | undefined;
    const server = createServer((client) => {
      socket = client;
      client.write(
        `${JSON.stringify({ protocol: 1, proxy: "/tmp/ya-mc-fixture/control.sock" })}\n`,
      );
      let bytes = "";
      client.on("data", (data) => {
        bytes += data.toString();
        while (bytes.includes("\n")) {
          const index = bytes.indexOf("\n");
          const request = JSON.parse(bytes.slice(0, index)) as Record<
            string,
            unknown
          >;
          bytes = bytes.slice(index + 1);
          requests.push(request);
          client.write(
            `${JSON.stringify({ request_id: request.request_id, accepted: true, enabled })}\n`,
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    const native = new NativeMachineControl(createConnection(path));
    try {
      expect(await native.pathname()).toBe("/tmp/ya-mc-fixture/control.sock");
      const abort = vi.fn(async () => {
        expect(requests.at(-1)?.operation).toBe("remove");
      });
      const session = {
        pid: 123,
        abort,
        iterator: (async function* () {})(),
      } as unknown as AgentSession;
      await native.bind(
        session,
        "owner",
        "00000000-0000-0000-0000-000000000001",
      );
      expect(requests[0]).toMatchObject({
        operation: "register",
        pid: 123,
        session_id: "owner",
      });
      await session.abort();
      await session.abort();
      expect(
        requests.filter((request) => request.operation === "remove"),
      ).toHaveLength(1);
      expect(abort).toHaveBeenCalledTimes(2);
      let lazyPid: number | undefined;
      const lazy = {
        get pid() {
          return lazyPid;
        },
        abort: vi.fn(async () => {}),
        iterator: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 15));
          lazyPid = 125;
          yield { type: "system", subtype: "init" };
        })(),
      } as unknown as AgentSession;
      const beforeLazy = requests.length;
      await native.bind(
        lazy,
        "lazy-owner",
        "00000000-0000-0000-0000-000000000002",
      );
      expect(requests).toHaveLength(beforeLazy);
      await lazy.iterator.next();
      expect(requests.at(-1)).toMatchObject({
        operation: "register",
        pid: 125,
        session_id: "lazy-owner",
      });
      await lazy.abort();
      expect(requests.at(-1)).toMatchObject({
        operation: "remove",
        session_id: "lazy-owner",
      });
      const canceled = {
        pid: undefined,
        abort: vi.fn(async () => {}),
        iterator: {
          next: vi.fn(async () => {
            throw new Error("must not start");
          }),
        },
      } as unknown as AgentSession;
      await native.bind(
        canceled,
        "canceled",
        "00000000-0000-0000-0000-000000000003",
      );
      await canceled.abort();
      const beforeCanceled = requests.length;
      await expect(canceled.iterator.next()).rejects.toThrow(
        "ended before launch",
      );
      expect(requests).toHaveLength(beforeCanceled);
      const origin = await proof();
      const launches: StartSessionOptions[] = [];
      const begin = async (options: StartSessionOptions) => {
        launches.push(options);
        return {
          pid: 124,
          abort: async () => {},
          iterator: (async function* () {})(),
        } as unknown as AgentSession;
      };
      const dependencies = {
        platform: "darwin",
        environment: { YEP_MC_CONTROL: "1" },
        delegation: native,
        verify: async () => ({
          root: "/verified",
          directory: "/verified/bin",
          command: "/verified/bin/machine-control",
          python: "/verified/python",
          version: "1.2.3",
          sourceRevision: "a".repeat(40),
          desktopDelegation: true,
        }),
      };
      const delegated = await startMachineControlSession(
        "codex",
        {
          cwd: "/project",
          permissionMode: "bypassPermissions",
          desktopControlOrigin: origin,
        },
        begin,
        dependencies,
      );
      expect(
        launches.at(-1)?.agentEnvironment?.MACHINE_CONTROL_DESKTOP_PROXY,
      ).toBe("/tmp/ya-mc-fixture/control.sock");
      expect(requests.at(-1)?.pid).toBe(124);
      await delegated.abort();
      enabled = false;
      await startMachineControlSession(
        "codex",
        {
          cwd: "/project",
          permissionMode: "bypassPermissions",
          desktopControlOrigin: origin,
        },
        begin,
        dependencies,
      );
      expect(
        launches.at(-1)?.agentEnvironment?.MACHINE_CONTROL_DESKTOP_PROXY,
      ).toBeUndefined();
      expect(requests.at(-1)?.operation).toBe("profile");
      enabled = true;
      const count = requests.length;
      await startMachineControlSession(
        "codex",
        {
          cwd: "/project",
          permissionMode: "bypassPermissions",
          desktopControlOrigin: { launch: "forged" },
        },
        begin,
        dependencies,
      );
      expect(
        launches.at(-1)?.agentEnvironment?.MACHINE_CONTROL_DESKTOP_PROXY,
      ).toBeUndefined();
      expect(requests).toHaveLength(count);
      socket?.destroy();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await expect(native.pathname()).rejects.toThrow("unavailable");
    } finally {
      native.close();
      socket?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
