import type { HttpBindings } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  DESKTOP_SESSION_COOKIE_NAME,
  type DesktopBootstrapService,
} from "../desktop/DesktopBootstrapService.js";

const MASTER_SECRET_HEADER = "x-yep-desktop-bootstrap-secret";
const RETURN_TO_BASE_URL = "http://desktop.local";
const MAX_RETURN_TO_BYTES = 8 * 1024;

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().split("%", 1)[0];
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

export function isLoopbackDesktopRequest(
  c: Context<{ Bindings: HttpBindings }>,
): boolean {
  const incoming = c.env?.incoming;
  const socket = incoming?.socket;
  // A local reverse proxy (tailscale serve/funnel) also connects from
  // loopback; its forwarding headers show the caller is not on this machine.
  const proxied = [
    "x-forwarded-for",
    "forwarded",
    "tailscale-funnel-request",
    "tailscale-user-login",
  ].some((name) => c.req.header(name) !== undefined);
  return (
    !proxied &&
    isLoopbackAddress(socket?.remoteAddress) &&
    isLoopbackAddress(socket?.localAddress)
  );
}

function shouldUseSecureCookie(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeDesktopReturnTo(value: string | undefined): string {
  if (
    !value ||
    new TextEncoder().encode(value).byteLength > MAX_RETURN_TO_BYTES ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }
  try {
    const target = new URL(value, RETURN_TO_BASE_URL);
    if (target.origin !== RETURN_TO_BASE_URL) {
      return "/";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

export function createDesktopBootstrapRoutes(
  service: DesktopBootstrapService,
): Hono<{ Bindings: HttpBindings }> {
  const routes = new Hono<{ Bindings: HttpBindings }>();

  routes.post("/check-updates", (c) => {
    // A desktop session is the existing local owner principal. Password/SRP,
    // forwarded relay requests and ambient loopback access grant no native UI.
    if (
      !service.onCheckUpdates ||
      !isLoopbackDesktopRequest(c) ||
      c.req.header("X-Yep-Anywhere") !== "true" ||
      c.req.header("Origin") !== new URL(c.req.url).origin ||
      !service.validateSession(getCookie(c, DESKTOP_SESSION_COOKIE_NAME))
    ) {
      return c.json({ error: "Not found" }, 404);
    }
    service.onCheckUpdates();
    c.header("Cache-Control", "no-store");
    return c.json({ accepted: true });
  });

  routes.post("/mint", (c) => {
    if (!isLoopbackDesktopRequest(c)) {
      return c.json({ error: "Not found" }, 404);
    }
    if (!service.canAttemptBootstrap()) {
      return c.json({ error: "Not found" }, 404);
    }
    if (!service.validateMasterSecret(c.req.header(MASTER_SECRET_HEADER))) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(service.mintCode());
  });

  routes.get("/:code", (c) => {
    if (!isLoopbackDesktopRequest(c)) {
      return c.text("Not found", 404);
    }
    if (!service.canAttemptBootstrap()) {
      return c.text("Too many attempts", 429);
    }

    const session = service.consumeCode(c.req.param("code"));
    if (!session) {
      return c.text("Invalid or expired desktop bootstrap", 404);
    }

    setCookie(c, DESKTOP_SESSION_COOKIE_NAME, session, {
      httpOnly: true,
      sameSite: "Strict",
      secure: shouldUseSecureCookie(c.req.url),
      path: "/",
    });
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(sanitizeDesktopReturnTo(c.req.query("return_to")), 303);
  });

  return routes;
}
