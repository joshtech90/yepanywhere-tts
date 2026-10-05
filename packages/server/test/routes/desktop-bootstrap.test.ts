import type { HttpBindings } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_SESSION_COOKIE_NAME,
  DesktopBootstrapService,
} from "../../src/desktop/DesktopBootstrapService.js";
import {
  createDesktopBootstrapRoutes,
  sanitizeDesktopReturnTo,
} from "../../src/routes/desktop-bootstrap.js";

const MASTER_SECRET = "s".repeat(64);

function socketBindings(
  remoteAddress = "127.0.0.1",
  localAddress = "127.0.0.1",
): HttpBindings {
  return {
    incoming: {
      socket: { remoteAddress, localAddress },
    },
  } as unknown as HttpBindings;
}

describe("desktop bootstrap routes", () => {
  it("mints on loopback and exchanges a code for a host-only cookie once", async () => {
    const service = new DesktopBootstrapService({
      masterSecret: MASTER_SECRET,
    });
    const routes = createDesktopBootstrapRoutes(service);
    const bindings = socketBindings();

    const mint = await routes.request(
      "http://127.0.0.1/mint",
      {
        method: "POST",
        headers: {
          "x-yep-desktop-bootstrap-secret": MASTER_SECRET,
        },
      },
      bindings,
    );
    const { code } = (await mint.json()) as { code: string };
    const exchange = await routes.request(
      `http://127.0.0.1/${code}`,
      undefined,
      bindings,
    );

    expect(mint.status).toBe(200);
    expect(exchange.status).toBe(303);
    expect(exchange.headers.get("location")).toBe("/");
    expect(exchange.headers.get("cache-control")).toBe("no-store");
    const cookie = exchange.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${DESKTOP_SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");

    const session = cookie
      .split(";")[0]
      ?.slice(`${DESKTOP_SESSION_COOKIE_NAME}=`.length);
    expect(service.validateSession(session)).toBe(true);

    const replay = await routes.request(
      `http://127.0.0.1/${code}`,
      undefined,
      bindings,
    );
    expect(replay.status).toBe(404);
  });

  it("conceals the mint route from non-loopback or unauthenticated callers", async () => {
    const routes = createDesktopBootstrapRoutes(
      new DesktopBootstrapService({ masterSecret: MASTER_SECRET }),
    );

    const remote = await routes.request(
      "http://127.0.0.1/mint",
      {
        method: "POST",
        headers: {
          "x-yep-desktop-bootstrap-secret": MASTER_SECRET,
        },
      },
      socketBindings("192.0.2.8"),
    );
    const wrongSecret = await routes.request(
      "http://127.0.0.1/mint",
      {
        method: "POST",
        headers: {
          "x-yep-desktop-bootstrap-secret": "x".repeat(64),
        },
      },
      socketBindings(),
    );

    expect(remote.status).toBe(404);
    expect(wrongSecret.status).toBe(404);
  });

  it("treats a local reverse proxy (tailscale funnel) as not local", async () => {
    const routes = createDesktopBootstrapRoutes(
      new DesktopBootstrapService({ masterSecret: MASTER_SECRET }),
    );

    const proxied = await routes.request(
      "http://127.0.0.1/mint",
      {
        method: "POST",
        headers: {
          "x-yep-desktop-bootstrap-secret": MASTER_SECRET,
          "tailscale-funnel-request": "?1",
          "x-forwarded-for": "203.0.113.9",
        },
      },
      socketBindings(),
    );

    expect(proxied.status).toBe(404);
  });

  it("returns a bootstrapped dashboard to its saved same-origin route", async () => {
    const service = new DesktopBootstrapService({
      masterSecret: MASTER_SECRET,
    });
    const routes = createDesktopBootstrapRoutes(service);
    const bindings = socketBindings();
    const { code } = service.mintCode();

    const exchange = await routes.request(
      `http://127.0.0.1/${code}?return_to=${encodeURIComponent(
        "/sessions/abc?view=all#turn-4",
      )}`,
      undefined,
      bindings,
    );

    expect(exchange.status).toBe(303);
    expect(exchange.headers.get("location")).toBe(
      "/sessions/abc?view=all#turn-4",
    );
  });

  it("rejects cross-origin and malformed bootstrap return targets", () => {
    expect(sanitizeDesktopReturnTo("//example.com/session")).toBe("/");
    expect(sanitizeDesktopReturnTo("https://example.com/session")).toBe("/");
    expect(sanitizeDesktopReturnTo("/\\example.com/session")).toBe("/");
    expect(sanitizeDesktopReturnTo(`/${"é".repeat(4096)}`)).toBe("/");
    expect(sanitizeDesktopReturnTo("/sessions/abc?view=all#turn-4")).toBe(
      "/sessions/abc?view=all#turn-4",
    );
  });
});

describe("native update handoff", () => {
  it("admits only same-origin loopback requests with the desktop owner cookie", async () => {
    let calls = 0;
    const service = new DesktopBootstrapService({
      masterSecret: MASTER_SECRET,
      onCheckUpdates: () => {
        calls += 1;
      },
    });
    const session = service.consumeCode(service.mintCode().code)!;
    const routes = createDesktopBootstrapRoutes(service);
    const headers = {
      Origin: "http://127.0.0.1",
      "X-Yep-Anywhere": "true",
      Cookie: `${DESKTOP_SESSION_COOKIE_NAME}=${session}`,
    };
    const accepted = await routes.request(
      "http://127.0.0.1/check-updates",
      { method: "POST", headers },
      socketBindings(),
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(calls).toBe(1);
    for (const [overrides, bindings] of [
      [{ Origin: "http://attacker.invalid" }, socketBindings()],
      [{ Origin: "" }, socketBindings()],
      [{ "X-Yep-Anywhere": "" }, socketBindings()],
      [{ Cookie: "" }, socketBindings()],
      [{ Cookie: `${DESKTOP_SESSION_COOKIE_NAME}=wrong` }, socketBindings()],
      [{}, socketBindings("192.0.2.8")],
      [{}, socketBindings("127.0.0.1", "192.0.2.9")],
    ] as const) {
      const refused = await routes.request(
        "http://127.0.0.1/check-updates",
        { method: "POST", headers: { ...headers, ...overrides } },
        bindings,
      );
      expect(refused.status).toBe(404);
    }
    expect(calls).toBe(1);
  });
  it("does not expose native actions when an old shell did not opt in", async () => {
    const service = new DesktopBootstrapService({
      masterSecret: MASTER_SECRET,
    });
    const session = service.consumeCode(service.mintCode().code)!;
    const response = await createDesktopBootstrapRoutes(service).request(
      "http://127.0.0.1/check-updates",
      {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1",
          "X-Yep-Anywhere": "true",
          Cookie: `${DESKTOP_SESSION_COOKIE_NAME}=${session}`,
        },
      },
      socketBindings(),
    );
    expect(response.status).toBe(404);
  });
});
