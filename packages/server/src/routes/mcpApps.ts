import {
  MCP_APP_MODEL_CONTEXT_LIMIT,
  type McpAppApprovalRequired,
  type McpAppHostRequest,
  mcpAppToolVisibleToApp,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import type { Process } from "../supervisor/Process.js";

type SessionProcessLookup = (sessionId: string) => Process | undefined;

interface McpToolDescriptor {
  name?: unknown;
  title?: unknown;
  annotations?: unknown;
  _meta?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Validate the client's request shape; undefined means malformed. */
export function parseMcpAppHostRequest(
  body: unknown,
): McpAppHostRequest | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (!isNonEmptyString(record.server)) return undefined;
  switch (record.kind) {
    case "readResource":
      if (!isNonEmptyString(record.uri)) return undefined;
      if (
        record.originCallId !== undefined &&
        !isNonEmptyString(record.originCallId)
      )
        return undefined;
      return {
        kind: "readResource",
        server: record.server,
        uri: record.uri,
        ...(record.originCallId
          ? { originCallId: record.originCallId as string }
          : {}),
      };
    case "callTool": {
      if (!isNonEmptyString(record.tool)) return undefined;
      const args = record.arguments;
      if (
        args !== undefined &&
        (!args || typeof args !== "object" || Array.isArray(args))
      )
        return undefined;
      return {
        kind: "callTool",
        server: record.server,
        tool: record.tool,
        ...(args ? { arguments: args as Record<string, unknown> } : {}),
        approved: record.approved === true,
      };
    }
    case "updateModelContext":
      if (!isNonEmptyString(record.key) || !isNonEmptyString(record.tool))
        return undefined;
      if (
        record.text !== null &&
        (typeof record.text !== "string" ||
          record.text.length > MCP_APP_MODEL_CONTEXT_LIMIT + 1)
      )
        return undefined;
      return {
        kind: "updateModelContext",
        key: record.key,
        server: record.server,
        tool: record.tool,
        text: record.text,
      };
    default:
      return undefined;
  }
}

function readOnlyTool(tool: McpToolDescriptor): boolean {
  return (
    !!tool.annotations &&
    typeof tool.annotations === "object" &&
    (tool.annotations as Record<string, unknown>).readOnlyHint === true
  );
}

/**
 * A view's requests, served through the provider session that made its tool
 * call (topics/mcp-apps.md). The client's bridge decides which view may ask;
 * this route enforces the server-side half: hosting enabled, a live
 * unsandboxed provider session, app visibility, and reader approval.
 */
export function createMcpAppRoutes(deps: {
  getProcessForSession: SessionProcessLookup;
  isEnabled: () => boolean;
}) {
  const routes = new Hono();
  routes.post(
    "/projects/:projectId/sessions/:sessionId/mcp-apps",
    async (c) => {
      if (!deps.isEnabled()) {
        return c.json(
          { error: "MCP App views are turned off", reason: "disabled" },
          409,
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      const request = parseMcpAppHostRequest(body);
      if (!request) {
        return c.json({ error: "Malformed MCP App request" }, 400);
      }
      const process = deps.getProcessForSession(c.req.param("sessionId"));
      if (!process) {
        return c.json(
          {
            error: "The session is not running, so its MCP servers are gone",
            reason: "session-not-running",
          },
          409,
        );
      }
      // A sandbox exists to withhold authority; the bridge must not lend its
      // MCP servers back to the session through the reader's browser.
      if (process.sandboxEnforcement?.state === "enforced") {
        return c.json(
          {
            error: "MCP App views are unavailable in sandboxed sessions",
            reason: "sandboxed",
          },
          409,
        );
      }
      if (!process.supportsMcpApps) {
        return c.json(
          {
            error:
              "This session cannot host MCP App views; sessions started before views were turned on need a restart",
            reason: "unsupported",
          },
          409,
        );
      }
      try {
        if (request.kind === "callTool") {
          const tools = (await process.mcpAppRequest({
            kind: "listTools",
            server: request.server,
          })) as Record<string, McpToolDescriptor | undefined>;
          const tool = tools[request.tool];
          if (!tool) {
            return c.json(
              {
                error: `${request.server} offers no tool ${request.tool}`,
                reason: "unknown-tool",
              },
              404,
            );
          }
          if (!mcpAppToolVisibleToApp(tool._meta)) {
            return c.json(
              {
                error: `${request.tool} is not callable from its app`,
                reason: "not-app-visible",
              },
              403,
            );
          }
          if (
            !request.approved &&
            !readOnlyTool(tool) &&
            process.permissionMode !== "bypassPermissions"
          ) {
            const approval: McpAppApprovalRequired = {
              approvalRequired: true,
              toolTitle: isNonEmptyString(tool.title)
                ? tool.title
                : request.tool,
            };
            return c.json(approval);
          }
          const { approved: _approved, ...providerRequest } = request;
          return c.json(await process.mcpAppRequest(providerRequest));
        }
        return c.json(await process.mcpAppRequest(request));
      } catch (error) {
        return c.json(
          {
            error: error instanceof Error ? error.message : String(error),
            reason: "provider-error",
          },
          502,
        );
      }
    },
  );
  return routes;
}
