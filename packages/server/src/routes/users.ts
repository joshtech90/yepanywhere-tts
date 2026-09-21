/**
 * Limited-user administration and the acting-identity surface.
 *
 * Contract: topics/limited-users.md § Delivery v1.
 *
 * Every route but `/me` and `/logout` is the superuser's; the authorization
 * middleware already refuses the rest for a limited principal, and these
 * handlers re-check rather than trust that, because a missing middleware
 * mount must not silently open user administration.
 */

import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ActingPrincipal, LimitedUserSummary } from "@yep-anywhere/shared";
import { limitedUsernameError } from "@yep-anywhere/shared";
import type { LimitedUsersService } from "../auth/LimitedUsersService.js";
import {
  ACTING_USER_COOKIE,
  type Principal,
  PRINCIPAL_VARIABLE,
  signActingUser,
} from "../auth/principal.js";
import { SESSION_COOKIE_NAME, shouldUseSecureCookie } from "../auth/routes.js";
import type { AuthService } from "../auth/AuthService.js";
import type { UserUsageService } from "../auth/UserUsageService.js";

export interface UsersRoutesDeps {
  limitedUsers: LimitedUsersService;
  authService: AuthService;
  isEnabled: () => boolean;
  setEnabled?: (enabled: boolean) => Promise<void>;
  /** Absent on a server built without the usage ledger; usage then 404s. */
  userUsage?: UserUsageService;
}

interface UserBody {
  username?: string;
  password?: string;
  newSessionProjects?: string[];
  joinProjects?: string[];
  viewProjects?: string[];
  joinStaleOffsetMinutes?: number;
  lock?: { provider?: string; model?: string; effort?: string };
  projectRoot?: string;
  disabled?: boolean;
}

function principalOf(c: Context): Principal {
  return (
    (c.get(PRINCIPAL_VARIABLE) as Principal | undefined) ?? {
      kind: "superuser",
    }
  );
}

export function createUsersRoutes(deps: UsersRoutesDeps): Hono {
  const app = new Hono();
  const { limitedUsers, authService, isEnabled } = deps;

  const requireSuperuser = (c: Context): Response | null => {
    const principal = principalOf(c);
    if (principal.kind !== "superuser") {
      return c.json({ error: "Not permitted for this user" }, 403);
    }
    return null;
  };

  /** GET /api/users/me — who this client is acting as, and what they may do. */
  app.get("/me", (c) => {
    const principal = principalOf(c);
    const enabled = isEnabled();
    if (principal.kind === "superuser") {
      const body: ActingPrincipal = {
        superuser: true,
        username: null,
        switched: false,
        locked: false,
        enabled,
        hasLimitedUsers: limitedUsers.list().length > 0,
        logoutRedirect: "stay",
      };
      return c.json(body);
    }
    const body: ActingPrincipal = {
      superuser: principal.switched,
      username: principal.username || null,
      switched: principal.switched,
      locked: principal.locked,
      grants: principal.grants,
      enabled,
      // Trivially true for a limited principal, and deliberately not a count:
      // one limited user learns nothing about the others from this.
      hasLimitedUsers: true,
      logoutRedirect: principal.switched
        ? "stay"
        : principal.via === "relay"
          ? "relay-login"
          : "direct-login",
    };
    return c.json(body);
  });

  /**
   * POST /api/users/logout — end the acting identity.
   *
   * A switched superuser drops back to their own full access; a limited user
   * who actually logged in has their session invalidated and is told where to
   * log in again.
   */
  app.post("/logout", async (c) => {
    const principal = principalOf(c);
    deleteCookie(c, ACTING_USER_COOKIE, { path: "/" });
    if (principal.kind === "limited" && !principal.switched) {
      const sessionId = getCookie(c, SESSION_COOKIE_NAME);
      if (sessionId) await authService.invalidateSession(sessionId);
      deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
      return c.json({
        success: true,
        redirect: principal.via === "relay" ? "relay-login" : "direct-login",
      });
    }
    return c.json({ success: true, redirect: "stay" });
  });

  /** POST /api/users/switch — superuser acts as a limited user, for testing. */
  app.post("/switch", async (c) => {
    const denied = requireSuperuser(c);
    if (denied) return denied;
    if (!isEnabled()) {
      return c.json({ error: "Limited users are not enabled" }, 409);
    }

    let body: { username?: string | null };
    try {
      body = await c.req.json<{ username?: string | null }>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const username = body.username?.trim();
    if (!username) {
      deleteCookie(c, ACTING_USER_COOKIE, { path: "/" });
      return c.json({ success: true, username: null });
    }
    if (!limitedUsers.getActiveGrants(username)) {
      return c.json({ error: "User not found or disabled" }, 404);
    }
    setCookie(
      c,
      ACTING_USER_COOKIE,
      signActingUser(username, authService.getCookieSecret()),
      {
        httpOnly: true,
        secure: shouldUseSecureCookie(c),
        sameSite: "Lax",
        path: "/",
        maxAge: 24 * 60 * 60,
      },
    );
    return c.json({ success: true, username });
  });

  /** GET /api/users — the directory, superuser only. */
  app.get("/", (c) => {
    const denied = requireSuperuser(c);
    if (denied) return denied;
    const users: LimitedUserSummary[] = limitedUsers.list();
    return c.json({ users, enabled: isEnabled() });
  });

  /** POST /api/users — create a limited user. */
  app.post("/", async (c) => {
    const denied = requireSuperuser(c);
    if (denied) return denied;

    let body: UserBody;
    try {
      body = await c.req.json<UserBody>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const usernameError = limitedUsernameError(body.username ?? "");
    if (usernameError) return c.json({ error: usernameError }, 400);

    try {
      const user = await limitedUsers.create({
        username: body.username as string,
        password: body.password,
        newSessionProjects: body.newSessionProjects,
        joinProjects: body.joinProjects,
        viewProjects: body.viewProjects,
        joinStaleOffsetMinutes: body.joinStaleOffsetMinutes,
        lock: body.lock,
        projectRoot: body.projectRoot,
        disabled: body.disabled,
      });
      if (!isEnabled()) await deps.setEnabled?.(true);
      return c.json({ user }, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  /** PATCH /api/users/:username — edit grants, lock, password, enabled. */
  app.patch("/:username", async (c) => {
    const denied = requireSuperuser(c);
    if (denied) return denied;

    let body: UserBody;
    try {
      body = await c.req.json<UserBody>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    try {
      const user = await limitedUsers.update(c.req.param("username"), {
        password: body.password,
        newSessionProjects: body.newSessionProjects,
        joinProjects: body.joinProjects,
        viewProjects: body.viewProjects,
        joinStaleOffsetMinutes: body.joinStaleOffsetMinutes,
        lock: body.lock,
        projectRoot: body.projectRoot,
        disabled: body.disabled,
      });
      return c.json({ user });
    } catch (error) {
      const message = (error as Error).message;
      return c.json(
        { error: message },
        message === "User not found" ? 404 : 400,
      );
    }
  });

  /**
   * GET /api/users/usage — per-principal usage, superuser only.
   *
   * Listed before `/:username` so the literal path is not read as a username.
   */
  app.get("/usage", async (c) => {
    const denied = requireSuperuser(c);
    if (denied) return denied;
    if (!deps.userUsage) {
      return c.json({ error: "Usage is not recorded on this server" }, 404);
    }
    const knownUsernames = limitedUsers.list().map((user) => user.username);
    return c.json(await deps.userUsage.report(knownUsernames));
  });

  /** DELETE /api/users/:username */
  app.delete("/:username", async (c) => {
    const denied = requireSuperuser(c);
    if (denied) return denied;
    const username = c.req.param("username");
    const removed = await limitedUsers.remove(username);
    if (!removed) return c.json({ error: "User not found" }, 404);
    // Deleting a user takes their usage history with them.
    await deps.userUsage?.forgetUser(username);
    return c.json({ success: true });
  });

  return app;
}
