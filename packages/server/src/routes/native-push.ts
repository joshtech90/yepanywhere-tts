import { PutNativePushSubscriptionRequestSchema } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { getAuthenticatedSrpTransport } from "../middleware/authenticated-transport.js";
import type { NativePushService } from "../push/NativePushService.js";
import {
  SecurityClientServiceError,
  type SecurityClientService,
} from "../services/SecurityClientService.js";

export function createNativePushRoutes(
  clients: SecurityClientService,
  push: NativePushService,
): Hono {
  const routes = new Hono();
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  routes.onError((error, c) => {
    if (error instanceof SecurityClientServiceError)
      return c.json({ error: error.message, code: error.code }, error.status);
    return c.json({ error: "Native push operation failed" }, 500);
  });
  routes.put(
    "/api/security/clients/:clientId/native-push-subscription",
    async (c) => {
      const transport = getAuthenticatedSrpTransport(c.env);
      if (!transport)
        throw new SecurityClientServiceError(
          "security_client_transport_required",
          400,
          "An established SRP transport is required",
        );
      clients.requireNativePushOwner(c.req.param("clientId"), transport);
      if (
        c.req.header("Content-Type")?.split(";", 1)[0]?.trim() !==
        "application/json"
      )
        return c.json({ error: "JSON required" }, 415);
      const reader = c.req.raw.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > 8192) {
              await reader.cancel();
              return c.json({ error: "Body too large" }, 413);
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return c.json({ error: "Invalid JSON" }, 400);
      }
      const parsed = PutNativePushSubscriptionRequestSchema.safeParse(body);
      if (!parsed.success)
        return c.json({ error: "Invalid native push subscription" }, 400);
      return c.json(
        await clients.setNativePush(
          c.req.param("clientId"),
          transport,
          parsed.data,
          push.brokerUrl,
        ),
      );
    },
  );
  routes.delete(
    "/api/security/clients/:clientId/native-push-subscription",
    async (c) => {
      const transport = getAuthenticatedSrpTransport(c.env);
      if (!transport)
        throw new SecurityClientServiceError(
          "security_client_transport_required",
          400,
          "An established SRP transport is required",
        );
      return c.json(
        await clients.setNativePush(
          c.req.param("clientId"),
          transport,
          null,
          push.brokerUrl,
        ),
      );
    },
  );
  routes.post(
    "/api/security/clients/:clientId/native-push-subscription/test",
    async (c) => {
      const transport = getAuthenticatedSrpTransport(c.env);
      if (!transport)
        throw new SecurityClientServiceError(
          "security_client_transport_required",
          400,
          "An established SRP transport is required",
        );
      clients.requireNativePushOwner(c.req.param("clientId"), transport);
      const result = await push.test(c.req.param("clientId"));
      return c.json(
        {
          success: result.success,
          ...(result.error ? { code: result.error } : {}),
        },
        result.success ? 202 : 503,
      );
    },
  );
  routes.get(
    "/api/security/clients/:clientId/native-push-subscription/destination",
    (c) => {
      const transport = getAuthenticatedSrpTransport(c.env);
      if (!transport)
        throw new SecurityClientServiceError(
          "security_client_transport_required",
          400,
          "An established SRP transport is required",
        );
      const sessionId = c.req.query("sessionId") ?? "";
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId))
        return c.json({ error: "Invalid session id" }, 400);
      return c.json({
        path: clients.nativePushDestination(
          c.req.param("clientId"),
          transport,
          sessionId,
        ),
      });
    },
  );
  return routes;
}
