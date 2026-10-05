import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { startNativeSudoSession } from "../../src/sdk/providers/native-sudo.js";
import type {
  AgentSession,
  StartSessionOptions,
} from "../../src/sdk/providers/types.js";

const environment = {
  YEP_MC_SUDO_APP: "/Applications/Example.app",
  YEP_MC_SUDO_TEAM_ID: "EXAMPLE123",
  PATH: "/usr/bin:/bin",
};
const options: StartSessionOptions = {
  cwd: "/project",
  permissionMode: "bypassPermissions",
};

describe("native sudo launch capability", () => {
  it("does no work by default", async () => {
    const start = vi.fn(
      async (_options: StartSessionOptions) => ({}) as AgentSession,
    );
    const verify = vi.fn();
    await startNativeSudoSession("codex", options, start, {
      platform: "darwin",
      environment: {},
      verify,
    });
    expect(start).toHaveBeenCalledWith(options);
    expect(verify).not.toHaveBeenCalled();
  });

  it("shares only explicitly selected discovery and preserves sudo-specific configuration", async () => {
    const verify = vi.fn(async () => "/verified/resources");
    const start = vi.fn(
      async (_options: StartSessionOptions) => ({}) as AgentSession,
    );
    const shared = {
      YEP_MC_APP: "/Applications/Shared.app",
      YEP_MC_TEAM_ID: "SHARED1234",
      YEP_MC_CONTROL: "1",
    };
    await startNativeSudoSession("codex", options, start, {
      platform: "darwin",
      environment: shared,
      verify,
    });
    expect(verify).not.toHaveBeenCalled();
    expect(start).toHaveBeenLastCalledWith(options);
    await startNativeSudoSession("codex", options, start, {
      platform: "darwin",
      environment: { ...shared, YEP_MC_SUDO: "1" },
      verify,
    });
    expect(verify).toHaveBeenLastCalledWith(
      shared.YEP_MC_APP,
      shared.YEP_MC_TEAM_ID,
    );
    await startNativeSudoSession("codex", options, start, {
      platform: "darwin",
      environment: { ...shared, ...environment, YEP_MC_SUDO: "1" },
      verify,
    });
    expect(verify).toHaveBeenLastCalledWith(
      environment.YEP_MC_SUDO_APP,
      environment.YEP_MC_SUDO_TEAM_ID,
    );
  });

  it("does not advertise or verify for remote, sandboxed, plan, or unsupported launches", async () => {
    const verify = vi.fn();
    for (const [platform, launch] of [
      ["win32", options],
      ["linux", options],
      ["darwin", { ...options, permissionMode: "default" }],
      ["darwin", { ...options, permissionMode: "plan" }],
      ["darwin", { ...options, executor: { name: "remote" } }],
      [
        "darwin",
        { ...options, sessionSandboxOptions: { level: "project-write" } },
      ],
    ] as [string, StartSessionOptions][]) {
      const start = vi.fn(
        async (_options: StartSessionOptions) => ({}) as AgentSession,
      );
      await startNativeSudoSession("codex", launch, start, {
        platform,
        environment,
        verify,
      });
      expect(start).toHaveBeenCalledWith(launch);
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("adds only verified native paths and preserves existing instructions and grants", async () => {
    const verify = vi.fn(
      async () => "/Applications/Example App.app/Contents/Resources",
    );
    const start = vi.fn(
      async (_options: StartSessionOptions) => ({}) as AgentSession,
    );
    await startNativeSudoSession(
      "codex",
      {
        ...options,
        globalInstructions: "Existing instructions",
        agentEnvironment: { AGENT_YA_API_TOKEN: "synthetic-own-session-grant" },
      },
      start,
      { platform: "darwin", environment, verify },
    );
    const launch = start.mock.calls[0]?.[0] as StartSessionOptions;
    expect(verify).toHaveBeenCalledWith(
      environment.YEP_MC_SUDO_APP,
      environment.YEP_MC_SUDO_TEAM_ID,
    );
    expect(launch.agentEnvironment).toEqual({
      AGENT_YA_API_TOKEN: "synthetic-own-session-grant",
      PATH: `/Applications/Example App.app/Contents/Resources${delimiter}${environment.PATH}`,
    });
    expect(launch.globalInstructions).toContain("Existing instructions");
    expect(launch.globalInstructions).toContain(
      `'${join("/Applications/Example App.app/Contents/Resources", "mc-sudo")}'`,
    );
    expect(launch.globalInstructions).toContain(
      "without automatically retrying",
    );
  });

  it("refuses configured missing publisher and invalid installation before starting a provider", async () => {
    const start = vi.fn(
      async (_options: StartSessionOptions) => ({}) as AgentSession,
    );
    await expect(
      startNativeSudoSession("codex", options, start, {
        platform: "darwin",
        environment: { YEP_MC_SUDO_APP: "/untrusted" },
      }),
    ).rejects.toThrow("YEP_MC_SUDO_TEAM_ID");
    await expect(
      startNativeSudoSession("codex", options, start, {
        platform: "darwin",
        environment,
        verify: async () => {
          throw new Error("untrusted source");
        },
      }),
    ).rejects.toThrow("integrity verification");
    expect(start).not.toHaveBeenCalled();
  });
});
