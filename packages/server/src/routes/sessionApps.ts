import { existsSync } from "node:fs";
import { Hono } from "hono";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import { sandboxPortBrokerSocketPath } from "../session-sandbox.js";
import type { Process } from "../supervisor/Process.js";

type SessionProcessLookup = (sessionId: string) => Process | undefined;

/**
 * The port broker socket reaching this session's sandbox loopback, or null
 * when its live process is not firewalled or its broker is not running
 * (topics/session-sandbox-network-boundary.md § Inbound).
 */
export function sessionAppBrokerSocket(
  process: Pick<Process, "pid" | "sandboxEnforcement"> | undefined,
): string | null {
  const enforcement = process?.sandboxEnforcement;
  if (
    !process?.pid ||
    enforcement?.state !== "enforced" ||
    enforcement.networkFirewall !== true
  ) {
    return null;
  }
  const socket = sandboxPortBrokerSocketPath(process.pid);
  return existsSync(socket) ? socket : null;
}

/**
 * Offer a server a sandboxed session started on its private loopback as a
 * private app host (topics/session-right-pane.md § Sandboxed session apps).
 */
export function createSessionAppRoutes(deps: {
  getArtifactServer: () => ArtifactServer | undefined;
  getProcessForSession: SessionProcessLookup;
}) {
  const routes = new Hono();
  routes.post(
    "/projects/:projectId/sessions/:sessionId/sandbox-apps",
    async (c) => {
      let body: { port?: unknown };
      try {
        body = await c.req.json<{ port?: unknown }>();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      const port = body?.port;
      if (
        typeof port !== "number" ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      ) {
        return c.json({ error: "Expected a port from 1 to 65535" }, 400);
      }
      const artifactServer = deps.getArtifactServer();
      if (
        !artifactServer?.config.localOrigin &&
        !artifactServer?.config.vhostPublicRoot
      ) {
        return c.json(
          {
            error: "App serving is not configured on this server",
            reason: "apps-unconfigured",
          },
          409,
        );
      }
      const sessionId = c.req.param("sessionId");
      if (!sessionAppBrokerSocket(deps.getProcessForSession(sessionId))) {
        return c.json(
          {
            error:
              "This session is not running in a firewalled sandbox, so it has no app to offer",
            reason: "no-sandbox-broker",
          },
          409,
        );
      }
      await artifactServer.ready;
      const app = artifactServer.mintSessionApp(sessionId, port);
      return c.json({
        name: app.name,
        accessToken: artifactServer.vhostAccess.token({
          name: app.name,
          port: app.port,
        }),
      });
    },
  );
  return routes;
}
