import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/auth/AuthService.js";
import {
  LoginThrottle,
  PUBLIC_LOGIN_POLICY,
  loginThrottleKey,
} from "../../src/auth/loginThrottle.js";
import { createAuthRoutes } from "../../src/auth/routes.js";
import { setupAuth } from "../../src/cli-setup.js";

describe("loginThrottleKey", () => {
  const none = () => undefined;

  it("puts Funnel and unidentified proxied traffic in the public bucket", () => {
    expect(
      loginThrottleKey("100.1.2.3", (n) =>
        n === "tailscale-funnel-request" ? "?1" : undefined,
      ).key,
    ).toBe("public");
    expect(loginThrottleKey("127.0.0.1", none).key).toBe("public");
    expect(loginThrottleKey(undefined, none).key).toBe("public");
  });

  it("counts tailnet and LAN logins per address", () => {
    expect(loginThrottleKey("100.64.0.7", none).key).toBe("addr:100.64.0.7");
    expect(
      loginThrottleKey("127.0.0.1", (n) =>
        n === "tailscale-user-login" ? "joscha@example.com" : undefined,
      ).key,
    ).toBe("addr:127.0.0.1");
  });
});

describe("LoginThrottle", () => {
  it("locks after the allowed failures and doubles the next lockout", () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < PUBLIC_LOGIN_POLICY.maxFailures; i++) {
      expect(throttle.retryAfterMs("public")).toBe(0);
      throttle.recordFailure("public", PUBLIC_LOGIN_POLICY);
    }
    expect(throttle.retryAfterMs("public")).toBe(PUBLIC_LOGIN_POLICY.lockMs);

    now += PUBLIC_LOGIN_POLICY.lockMs;
    expect(throttle.retryAfterMs("public")).toBe(0);
    for (let i = 0; i < PUBLIC_LOGIN_POLICY.maxFailures; i++) {
      throttle.recordFailure("public", PUBLIC_LOGIN_POLICY);
    }
    expect(throttle.retryAfterMs("public")).toBe(
      PUBLIC_LOGIN_POLICY.lockMs * 2,
    );
  });

  it("forgets failures after a successful login", () => {
    const throttle = new LoginThrottle(() => 0);
    for (let i = 0; i < PUBLIC_LOGIN_POLICY.maxFailures - 1; i++) {
      throttle.recordFailure("public", PUBLIC_LOGIN_POLICY);
    }
    throttle.recordSuccess("public");
    throttle.recordFailure("public", PUBLIC_LOGIN_POLICY);
    expect(throttle.retryAfterMs("public")).toBe(0);
  });
});

describe("POST /login throttling", () => {
  let authService: AuthService;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "login-throttle-"));
    authService = new AuthService({
      dataDir: testDir,
      cookieSecret: "test-cookie-secret",
    });
    await authService.initialize();
    await authService.enableAuth("right-password");
  });

  afterEach(async () => {
    await authService.flushPendingWrites();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("answers 429 without checking the password once locked", async () => {
    const routes = createAuthRoutes({
      authService,
      loginThrottle: new LoginThrottle(),
    });
    const login = (password: string) =>
      routes.request("/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Tailscale-Funnel-Request": "?1",
        },
        body: JSON.stringify({ password }),
      });

    for (let i = 0; i < PUBLIC_LOGIN_POLICY.maxFailures; i++) {
      expect((await login("wrong")).status).toBe(401);
    }
    const locked = await login("right-password");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("counts parallel attempts before any password check finishes", async () => {
    const routes = createAuthRoutes({
      authService,
      loginThrottle: new LoginThrottle(),
    });
    const attempts = await Promise.all(
      Array.from({ length: 25 }, () =>
        routes.request("/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Tailscale-Funnel-Request": "?1",
          },
          body: JSON.stringify({ password: "wrong" }),
        }),
      ),
    );
    const checked = attempts.filter((res) => res.status === 401).length;
    expect(checked).toBe(PUBLIC_LOGIN_POLICY.maxFailures);
    expect(attempts.filter((res) => res.status === 429)).toHaveLength(
      25 - PUBLIC_LOGIN_POLICY.maxFailures,
    );
  });

  it("refuses oversized auth bodies before reading them", async () => {
    const routes = createAuthRoutes({ authService });
    const res = await routes.request("/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x".repeat(64 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});

describe("unreadable auth.json", () => {
  // AuthService.test.ts covers empty, truncated and unknown-version files;
  // these are well-formed JSON whose shape would otherwise read as "auth off".
  it.each([
    ["an empty object", "{}"],
    ["a non-boolean switch", '{"version":2,"enabled":"no","sessions":{}}'],
    ["a bare version 1", '{"version":1}'],
    ["a session that is not an object", '{"version":2,"sessions":{"x":1}}'],
    [
      "an account without a hash",
      '{"version":2,"enabled":true,"account":{},"sessions":{}}',
    ],
  ])("refuses to start for %s and keeps the file", async (_name, content) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-shape-"));
    const file = path.join(dir, "auth.json");
    await fs.writeFile(file, content);
    const service = new AuthService({ dataDir: dir, cookieSecret: "s" });
    await expect(service.initialize()).rejects.toThrow(
      /Refusing to start with local authentication off/,
    );

    expect(service.isEnabled()).toBe(false);
    await service.flushPendingWrites();
    expect(await fs.readFile(file, "utf8")).toBe(content);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("--setup-auth on an unreadable auth.json", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("replaces it with a new owner password and keeps a copy", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-repair-"));
    const file = path.join(dir, "auth.json");
    await fs.writeFile(file, "{ not json", { mode: 0o600 });
    vi.stubEnv("YEP_DATA_DIR", dir);

    await setupAuth({ password: "new-password" });

    const reloaded = new AuthService({ dataDir: dir, cookieSecret: "s" });
    await reloaded.initialize();
    expect(reloaded.isEnabled()).toBe(true);
    await expect(reloaded.verifyPassword("new-password")).resolves.toBe(true);
    const copies = (await fs.readdir(dir)).filter((name) =>
      name.startsWith("auth.json.unreadable-"),
    );
    expect(copies).toHaveLength(1);
    const copy = path.join(dir, copies[0] ?? "");
    expect(await fs.readFile(copy, "utf8")).toBe("{ not json");
    expect((await fs.stat(copy)).mode & 0o777).toBe(0o600);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("offers no repair for a file that was not refused", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-repair-"));
    const service = new AuthService({ dataDir: dir, cookieSecret: "s" });
    await service.initialize();
    await expect(service.adoptRefusedStateForRepair()).rejects.toThrow(
      /nothing to repair/,
    );
    await fs.rm(dir, { recursive: true, force: true });
  });
});
