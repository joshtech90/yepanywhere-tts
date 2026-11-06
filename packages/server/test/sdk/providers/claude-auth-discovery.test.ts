import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authCommand } = vi.hoisted(() => ({ authCommand: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: Object.assign(vi.fn(), {
      [promisify.custom]: (path: string, args: string[], options: object) =>
        args[0] === "--version"
          ? Promise.resolve({ stdout: "Claude Code fixture" })
          : authCommand(path, args, options),
    }),
  };
});

import { createProvidersRoutes } from "../../../src/routes/providers.js";
import { ClaudeProvider } from "../../../src/sdk/providers/claude.js";

describe("Claude catalog authentication discovery", () => {
  beforeEach(() => {
    vi.stubEnv("CLAUDE_CODE_EXECUTABLE", process.execPath);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    // Hosted runners have no shell Claude; login discovery probes --version.
    vi.stubEnv("PATH", "");
    authCommand.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("shares the authentication subprocess between status and model discovery", async () => {
    const pending = Promise.withResolvers<{ stdout: string }>();
    authCommand.mockReturnValue(pending.promise);
    const routes = createProvidersRoutes({ providers: [new ClaudeProvider()] });
    const response = routes.request("/claude");

    await vi.waitFor(() => expect(authCommand).toHaveBeenCalled());
    pending.resolve({ stdout: JSON.stringify({ loggedIn: false }) });
    const result = await response;

    expect(result.status).toBe(200);
    expect(authCommand).toHaveBeenCalledTimes(1);
    expect(authCommand).toHaveBeenCalledWith(
      process.execPath,
      ["auth", "status"],
      { encoding: "utf-8", timeout: 5000 },
    );
    expect(await result.json()).toMatchObject({
      provider: { name: "claude", authenticated: false },
    });
  });

  it("checks authentication again after a completed request", async () => {
    authCommand
      .mockResolvedValueOnce({ stdout: JSON.stringify({ loggedIn: false }) })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ loggedIn: true }) });
    const provider = new ClaudeProvider();

    expect((await provider.getAuthStatus()).authenticated).toBe(false);
    expect((await provider.getAuthStatus()).authenticated).toBe(true);
    expect(authCommand).toHaveBeenCalledTimes(2);
  });

  it("keeps a setup-token login authenticated when the status check fails", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fixture-token");
    authCommand.mockRejectedValue(
      new Error("authentication command timed out"),
    );

    const status = await new ClaudeProvider().getAuthStatus();

    expect(status).toMatchObject({ authenticated: true, enabled: true });
  });

  it("believes a logged-out answer even when the CLI exits non-zero", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fixture-token");
    authCommand.mockRejectedValue(
      Object.assign(new Error("exit 1"), {
        code: 1,
        stdout: JSON.stringify({ loggedIn: false }),
      }),
    );

    const status = await new ClaudeProvider().getAuthStatus();

    expect(status).toMatchObject({ authenticated: false, enabled: false });
  });

  it("releases a failed shared subprocess so a later check can recover", async () => {
    const pending = Promise.withResolvers<{ stdout: string }>();
    authCommand.mockReturnValueOnce(pending.promise);
    const provider = new ClaudeProvider();
    const checks = Promise.all([
      provider.getAuthStatus(),
      provider.getAuthStatus(),
    ]);
    await vi.waitFor(() => expect(authCommand).toHaveBeenCalledTimes(1));
    pending.reject(new Error("authentication command failed"));
    await checks;

    authCommand.mockResolvedValueOnce({
      stdout: JSON.stringify({ loggedIn: true }),
    });
    expect((await provider.getAuthStatus()).authenticated).toBe(true);
    expect(authCommand).toHaveBeenCalledTimes(2);
  });
});
