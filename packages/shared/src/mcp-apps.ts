/**
 * MCP Apps (extension `io.modelcontextprotocol/ui`, SEP-1865) host contract
 * shared by the server's provider adapters and the client's view bridge.
 * `topics/mcp-apps.md` owns the observable behavior.
 */

export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

/** Extension settings a host declares to MCP servers at initialize. */
export const MCP_APP_EXTENSION_SETTINGS: { mimeTypes: string[] } = {
  mimeTypes: [MCP_APP_MIME_TYPE],
};

/** Fixed artifact-origin path of the sandbox proxy that loads a view. */
export const MCP_APP_PROXY_PATH = "/.yep/mcp-app-proxy";

/**
 * The proxy frame needs its own origin's script authority to relay messages;
 * the view inside it gets an opaque origin (see the proxy's inner sandbox).
 */
export const MCP_APP_PROXY_SANDBOX = "allow-scripts allow-same-origin";
export const MCP_APP_VIEW_SANDBOX = "allow-scripts allow-forms";

export type McpAppDisplayMode = "inline" | "fullscreen";

/** A tool call whose MCP tool declared a UI resource. */
export interface McpAppToolCall {
  server: string;
  tool: string;
  resourceUri: string;
  displayMode: McpAppDisplayMode;
}

export interface McpAppResourceCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export interface McpAppPermissions {
  camera?: object;
  microphone?: object;
  geolocation?: object;
  clipboardWrite?: object;
}

/**
 * Requests the client sends on a view's behalf. The server routes them to the
 * live provider session that made the originating tool call.
 */
export type McpAppHostRequest =
  | {
      kind: "readResource";
      server: string;
      uri: string;
      originCallId?: string;
    }
  | {
      kind: "callTool";
      server: string;
      tool: string;
      arguments?: Record<string, unknown>;
      /** The reader allowed this call; required unless the tool is read-only. */
      approved?: boolean;
    }
  | {
      kind: "updateModelContext";
      /** One view's slot: a later update replaces it. */
      key: string;
      server: string;
      tool: string;
      /** Null clears the slot. */
      text: string | null;
    };

/** The provider-facing subset: approval is settled before reaching it. */
export type McpAppProviderRequest =
  | Extract<McpAppHostRequest, { kind: "readResource" | "updateModelContext" }>
  | (Omit<Extract<McpAppHostRequest, { kind: "callTool" }>, "approved"> & {
      kind: "callTool";
    })
  | { kind: "listTools"; server: string };

/** Answer to a `callTool` the reader has not yet allowed. */
export interface McpAppApprovalRequired {
  approvalRequired: true;
  toolTitle: string;
}

/** Longest held model context per view, in characters. */
export const MCP_APP_MODEL_CONTEXT_LIMIT = 8_000;

/** Marks injected view context so transcripts classify it as provider context. */
export const MCP_APP_CONTEXT_OPEN = "<mcp_app_context";
export const MCP_APP_CONTEXT_CLOSE = "</mcp_app_context>";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function formatMcpAppModelContext(
  server: string,
  tool: string,
  text: string,
): string {
  return `${MCP_APP_CONTEXT_OPEN} server="${escapeAttribute(server)}" tool="${escapeAttribute(tool)}">\n${text}\n${MCP_APP_CONTEXT_CLOSE}`;
}

/**
 * The text a view's `ui/update-model-context` contributes: its text content
 * blocks, then any structured content as JSON, capped. Null means empty.
 */
export function mcpAppModelContextText(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
  }
  if (record.structuredContent !== undefined) {
    parts.push(JSON.stringify(record.structuredContent));
  }
  const text = parts.join("\n").trim();
  if (!text) return null;
  return text.length > MCP_APP_MODEL_CONTEXT_LIMIT
    ? `${text.slice(0, MCP_APP_MODEL_CONTEXT_LIMIT)}…`
    : text;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Codex records `mcpAppUi` only when the tool also declares a preferred
 * display mode; the legacy `mcpAppResourceUri` names the view otherwise.
 */
export function mcpAppToolCallFromCodexItem(
  item: Record<string, unknown>,
  server: string,
  tool: string,
): McpAppToolCall | undefined {
  const ui =
    item.mcpAppUi && typeof item.mcpAppUi === "object"
      ? (item.mcpAppUi as Record<string, unknown>)
      : undefined;
  const resourceUri =
    readString(ui?.resourceUri) ?? readString(item.mcpAppResourceUri);
  if (!resourceUri) return undefined;
  return {
    server,
    tool,
    resourceUri,
    displayMode:
      ui?.preferredModelDisplayMode === "fullscreen" ? "fullscreen" : "inline",
  };
}

/** `_meta.ui.visibility`, defaulting to both audiences as the spec says. */
export function mcpAppToolVisibleToApp(toolMeta: unknown): boolean {
  if (!toolMeta || typeof toolMeta !== "object") return true;
  const ui = (toolMeta as Record<string, unknown>).ui;
  if (!ui || typeof ui !== "object") return true;
  const visibility = (ui as Record<string, unknown>).visibility;
  return !Array.isArray(visibility) || visibility.includes("app");
}
