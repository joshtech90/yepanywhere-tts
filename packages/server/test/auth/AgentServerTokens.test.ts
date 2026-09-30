import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentServerTokens,
  bearerToken,
} from "../../src/auth/AgentServerTokens.js";
import { AuthService } from "../../src/auth/AuthService.js";
import { createAuthMiddleware } from "../../src/middleware/auth.js";
import {
  agentServerEnvironmentFor,
  type StartSessionOptions,
} from "../../src/sdk/providers/types.js";

describe("AgentServerTokens", () => {
  it("mints only while enabled and stops accepting when disabled", () => {
    let enabled = false;
    const tokens = new AgentServerTokens(() => enabled);
    expect(tokens.mint()).toBeUndefined();

    enabled = true;
    const access = tokens.mint();
    if (!access) throw new Error("expected a token");
    expect(tokens.accepts(access.token)).toBe(true);
    expect(tokens.accepts(`${access.token}x`)).toBe(false);

    enabled = false;
    expect(tokens.accepts(access.token)).toBe(false);
    enabled = true;
    access.revoke();
    expect(tokens.accepts(access.token)).toBe(false);
  });

  it("revokes every token at once", () => {
    const tokens = new AgentServerTokens(() => true);
    const first = tokens.mint();
    const second = tokens.mint();
    tokens.revokeAll();
    expect(tokens.accepts(first?.token ?? "")).toBe(false);
    expect(tokens.accepts(second?.token ?? "")).toBe(false);
  });

  it("reads only a well-formed bearer header", () => {
    expect(bearerToken("Bearer abc_DEF-123")).toBe("abc_DEF-123");
    expect(bearerToken("bearer abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("operator API token authentication", () => {
  let testDir: string;
  let app: Hono;
  let tokens: AgentServerTokens;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-token-auth-"));
    const authService = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-cookie-secret",
    });
    await authService.initialize();
    await authService.enableAuth("correct horse battery");
    tokens = new AgentServerTokens(() => true);
    app = new Hono();
    app.use(
      "/api/*",
      createAuthMiddleware({ authService, agentServerTokens: tokens }),
    );
    app.get("/api/protected", (c) => c.json({ ok: true }));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const request = (authorization?: string) =>
    app.request("/api/protected", {
      headers: authorization ? { Authorization: authorization } : {},
    });

  it("admits a live token past password auth and refuses others", async () => {
    expect((await request()).status).toBe(401);
    expect((await request("Bearer not-a-token")).status).toBe(401);

    const access = tokens.mint();
    if (!access) throw new Error("expected a token");
    expect((await request(`Bearer ${access.token}`)).status).toBe(200);

    access.revoke();
    expect((await request(`Bearer ${access.token}`)).status).toBe(401);
  });
});

describe("agentServerEnvironmentFor", () => {
  const environment = { AGENT_SERVER_TOKEN: "t" };
  const launch = (extra: Partial<StartSessionOptions>) =>
    agentServerEnvironmentFor({
      cwd: "/p",
      agentServerEnvironment: environment,
      ...extra,
    });

  it("keeps the token out of sandboxed and remote launches", () => {
    expect(launch({})).toEqual(environment);
    expect(launch({ executor: "gpu-box" })).toBeUndefined();
    // A provider-runtime worker sees the sandbox only as its options.
    expect(
      launch({
        sessionSandboxOptions: {
          level: "project-write",
        } as StartSessionOptions["sessionSandboxOptions"],
      }),
    ).toBeUndefined();
  });
});
