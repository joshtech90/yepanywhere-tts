import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { delimiter } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSelfLease,
  type AgentSelfLease,
} from "../../src/agent-tools/service.js";
import {
  AgentSelfState,
  startAgentSelfSession,
} from "../../src/sdk/providers/agent-self.js";
import { MessageQueue } from "../../src/sdk/messageQueue.js";
import type {
  AgentSession,
  StartSessionOptions,
} from "../../src/sdk/providers/types.js";

const run = promisify(execFile);
const leases: AgentSelfLease[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(leases.splice(0).map((lease) => lease.dispose()));
});
async function leaseFor(id: string) {
  const state = new AgentSelfState("claude", {
    cwd: ".",
    resumeSessionId: id,
    model: "alias",
    effort: "low",
  });
  const lease = await createAgentSelfLease((launchId) =>
    state.snapshot(launchId),
  );
  leases.push(lease);
  return { lease, state };
}
async function command(lease: AgentSelfLease, sessionId: string, extra = {}) {
  const env = {
    ...process.env,
    ...lease.environment,
    AGENTCTL_SESSION_ID: sessionId,
    ...extra,
  };
  // The runtime creates a platform shell launcher, not a global executable.
  return await run(
    process.platform === "win32" ? "cmd.exe" : "sh",
    process.platform === "win32"
      ? ["/d", "/s", "/c", "ya-agent self --json"]
      : ["-c", "ya-agent self --json"],
    { env, timeout: 10000 },
  );
}

describe("ya-agent self real command/service", () => {
  it.each([
    [{ schemaVersion: 2 }, "unsupported-protocol"],
    [
      {
        schemaVersion: 1,
        scope: "owning-session",
        sessionId: "one",
        launch: {},
        selected: {},
        providerEvidence: {},
        pending: {},
      },
      "invalid-response",
    ],
  ])(
    "rejects incompatible or partial JSON reports: %j",
    async (body, error) => {
      const { lease } = await leaseFor("one");
      const server = createServer((_req, res) => res.end(JSON.stringify(body)));
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("No test address");
        await expect(
          command(lease, "one", {
            AGENT_YA_API_URL: `http://127.0.0.1:${address.port}`,
          }),
        ).rejects.toMatchObject({
          code: 6,
          stdout: expect.stringContaining(String(error)),
        });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
  it("uses token ownership when a non-Bash shell has no late session marker", async () => {
    const { lease } = await leaseFor("token-bound-session");
    expect(JSON.parse((await command(lease, "")).stdout).sessionId).toBe(
      "token-bound-session",
    );
  });

  it("expires grants and rejects missing launch context without exposing credentials", async () => {
    const { lease } = await leaseFor("expiring-session");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60 * 1000 + 1);
    await expect(command(lease, "expiring-session")).rejects.toMatchObject({
      code: 4,
      stdout: expect.stringContaining('"expired"'),
    });
    await expect(
      command(lease, "expiring-session", { AGENT_YA_API_TOKEN: "" }),
    ).rejects.toMatchObject({
      code: 3,
      stdout: expect.stringContaining('"unavailable"'),
    });
  });
  it("executes the source-distributed command and separates evidence from selection", async () => {
    const { lease, state } = await leaseFor("session-one");
    state.observe({
      type: "system",
      subtype: "init",
      session_id: "session-one",
      model: "resolved-model",
    });
    state.select({ effort: "high", pendingEffort: true });
    const result = JSON.parse((await command(lease, "session-one")).stdout);
    expect(result).toMatchObject({
      schemaVersion: 1,
      sessionId: "session-one",
      scope: "owning-session",
      activeInference: "unknown",
      launch: { model: { value: "alias" }, effort: { value: "low" } },
      selected: { effort: { value: "high" } },
      pending: { effort: true },
      providerEvidence: {
        model: { value: "resolved-model", source: "provider-init" },
        effort: { status: "unknown" },
      },
    });
    state.accepted("effort", "high");
    state.select({ pendingEffort: false });
    expect(
      JSON.parse((await command(lease, "session-one")).stdout),
    ).toMatchObject({
      pending: { effort: false },
      providerEvidence: {
        effort: { value: "high", source: "adapter-control", scope: "session" },
      },
    });
  });

  it("isolates simultaneous session credentials and revokes only the ended lease", async () => {
    const first = await leaseFor("one");
    const second = await leaseFor("two");
    await expect(command(first.lease, "two")).rejects.toMatchObject({
      code: 4,
      stdout: expect.stringContaining("session-mismatch"),
    });
    await expect(
      command(first.lease, "one", { AGENT_YA_API_TOKEN: "wrong" }),
    ).rejects.toMatchObject({
      code: 4,
      stdout: expect.stringContaining("unauthorized"),
    });
    await first.lease.dispose();
    await expect(command(first.lease, "one")).rejects.toMatchObject({
      code: 4,
    });
    expect(
      JSON.parse((await command(second.lease, "two")).stdout).sessionId,
    ).toBe("two");
    const directory = second.lease.environment.PATH?.split(delimiter)[0] ?? "";
    await second.lease.dispose();
    expect(existsSync(directory)).toBe(false);
  });

  it("reports provider default separately from unknown evidence", () => {
    const state = new AgentSelfState("codex", {
      cwd: ".",
      resumeSessionId: "default-session",
    });
    expect(state.snapshot("launch")).toMatchObject({
      selected: {
        model: { status: "default", value: null },
        effort: { status: "default" },
      },
      providerEvidence: {
        model: { status: "unknown" },
        effort: { status: "unknown" },
      },
    });
  });

  it("rejects an unbound session and exposes no other API", async () => {
    const lease = await createAgentSelfLease(() => null);
    leases.push(lease);
    await expect(command(lease, "early")).rejects.toMatchObject({
      code: 5,
      stdout: expect.stringContaining("session-not-ready"),
    });
    const response = await fetch(
      `${lease.environment.AGENT_YA_API_URL}/api/settings`,
      {
        headers: {
          Authorization: `Bearer ${lease.environment.AGENT_YA_API_TOKEN}`,
        },
      },
    );
    expect(response.status).toBe(404);
  });

  it.each([
    { agentSelf: false },
    { executor: "remote" },
    { sessionSandboxOptions: { level: "project-write" } },
    { permissionMode: "default" },
  ])(
    "does not grant unsupported/disabled Codex launches: %j",
    async (overrides) => {
      let received: StartSessionOptions | undefined;
      const fake: AgentSession = {
        queue: new MessageQueue(),
        iterator: (async function* () {})(),
        abort() {},
      };
      await startAgentSelfSession(
        "codex",
        {
          cwd: ".",
          agentSelf: true,
          permissionMode: "bypassPermissions",
          ...overrides,
        } as StartSessionOptions,
        async (options) => {
          received = options;
          return fake;
        },
      );
      expect(received?.agentEnvironment).toBeUndefined();
    },
  );
});
