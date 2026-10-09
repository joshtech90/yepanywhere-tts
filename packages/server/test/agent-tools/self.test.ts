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
  const lease = await createAgentSelfLease({
    self: (launchId) => state.snapshot(launchId),
    view: () => state.viewSnapshot(),
  });
  leases.push(lease);
  return { lease, state };
}
async function command(
  lease: AgentSelfLease,
  sessionId: string,
  extra = {},
  args = "self --json",
) {
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
      ? ["/d", "/s", "/c", `ya-agent ${args}`]
      : ["-c", `ya-agent ${args}`],
    { env, timeout: 10000 },
  );
}

// Each `command` spawns a shell and the ya-agent launcher. CI runs measured
// 0.9-1.7 s per spawn (2026-10-06/07 unit-tests jobs: the one-spawn token
// case took 896-1706 ms); the four- and five-spawn cases took 3.0-3.7 s, then
// hit the 5 s default on the slower 92b5f8a66 and 8f03d343f runs. 20 s is
// about 2.5x the ~8 s five spawns reach at 1.7 s each.
describe("ya-agent self real command/service", { timeout: 20_000 }, () => {
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

  it("reports each tab's view separately and selects the most recently focused", async () => {
    const { lease, state } = await leaseFor("viewed-session");
    expect(
      JSON.parse(
        (await command(lease, "viewed-session", {}, "view --json")).stdout,
      ),
    ).toMatchObject({
      sessionId: "viewed-session",
      selectedClientId: null,
      selection: "none",
      clients: [],
    });
    const app = {
      kind: "app",
      label: "review",
      target: "http://localhost:19432/",
      url: "https://review.example.test/",
      openedBy: "session",
      state: "open",
      placement: "right-pane",
    } as const;
    state.publishViews([
      {
        clientId: "phone-tab",
        device: "Android",
        focused: false,
        viewers: [],
        publishedAt: "2026-10-06T10:00:02.000Z",
        focusedAt: "2026-10-06T10:00:00.000Z",
      },
      {
        clientId: "desk-tab",
        device: "Linux",
        focused: true,
        viewers: [app],
        publishedAt: "2026-10-06T10:00:01.000Z",
        focusedAt: "2026-10-06T10:00:01.000Z",
      },
    ]);
    const report = JSON.parse(
      (await command(lease, "viewed-session", {}, "view --json")).stdout,
    );
    expect(report).toMatchObject({
      selectedClientId: "desk-tab",
      selection: "most-recently-focused",
      clients: [
        { clientId: "desk-tab", viewers: [app] },
        { clientId: "phone-tab", viewers: [] },
      ],
    });
    const human = (await command(lease, "viewed-session", {}, "view")).stdout;
    expect(human).toContain('app "review": http://localhost:19432/');
    expect(human).toContain("opened by session");
    expect(human).not.toContain("phone-tab");
    expect(human).toContain("1 other tab(s)");
    const all = (await command(lease, "viewed-session", {}, "view --all"))
      .stdout;
    expect(all).toContain("Client phone-tab (Android): last focused");
    expect(all).toContain("Transcript only");
    await expect(
      command(lease, "viewed-session", {}, "view --verbose"),
    ).rejects.toMatchObject({ code: 2 });
  });

  it("forwards supervisor views through the owning-session proxy", async () => {
    let environment: Record<string, string> | undefined;
    let report: unknown;
    const session = await startAgentSelfSession(
      "claude",
      { cwd: ".", agentSelf: true, resumeSessionId: "proxied-session" },
      async (options) => {
        environment = options.agentEnvironment;
        return {
          queue: new MessageQueue(),
          abort() {},
          iterator: (async function* () {})(),
        };
      },
    );
    await session.publishAgentSessionViews?.([
      {
        clientId: "only-tab",
        device: "Mac",
        focused: true,
        viewers: [],
        publishedAt: "2026-10-06T10:00:00.000Z",
        focusedAt: "2026-10-06T10:00:00.000Z",
      },
    ]);
    try {
      const response = await fetch(`${environment?.AGENT_YA_API_URL}/v1/view`, {
        headers: { Authorization: `Bearer ${environment?.AGENT_YA_API_TOKEN}` },
      });
      report = await response.json();
    } finally {
      await session.abort();
    }
    expect(report).toMatchObject({
      sessionId: "proxied-session",
      selectedClientId: "only-tab",
    });
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
    const lease = await createAgentSelfLease({
      self: () => null,
      view: () => null,
    });
    leases.push(lease);
    for (const args of ["self --json", "view --json"])
      await expect(command(lease, "early", {}, args)).rejects.toMatchObject({
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
