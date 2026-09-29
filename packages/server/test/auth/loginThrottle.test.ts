import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../../src/auth/AuthService.js";
import {
  LoginThrottle,
  PUBLIC_LOGIN_POLICY,
  loginThrottleKey,
} from "../../src/auth/loginThrottle.js";
import { createAuthRoutes } from "../../src/auth/routes.js";

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
});
