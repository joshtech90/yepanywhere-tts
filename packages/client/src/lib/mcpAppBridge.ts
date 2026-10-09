import {
  MCP_APP_PROTOCOL_VERSION,
  type McpAppDisplayMode,
  type McpAppResourceCsp,
} from "@yep-anywhere/shared";

/**
 * The host side of the MCP Apps `ui/*` JSON-RPC dialogue (SEP-1865) with one
 * view, through the sandbox proxy frame. Transport-free: the owner feeds it
 * window messages and supplies the handlers that reach YA. Only messages from
 * the proxy frame's window and origin are read; everything is sent to that
 * origin alone. topics/mcp-apps.md owns the observable contract.
 */

export interface McpAppBridgeHandlers {
  callTool(
    name: string,
    args: Record<string, unknown> | undefined,
  ): Promise<unknown>;
  readResource(uri: string): Promise<unknown>;
  openLink(url: string): void;
  message(text: string): void;
  updateModelContext(params: unknown): Promise<void>;
  requestDisplayMode(mode: string): McpAppDisplayMode;
  sizeChanged(size: { width?: number; height?: number }): void;
}

export interface McpAppBridgeOptions {
  frame: () => Window | null | undefined;
  proxyOrigin: string;
  html: string;
  csp: McpAppResourceCsp;
  hostContext: Record<string, unknown>;
  toolInput: unknown;
  hostVersion: string;
  handlers: McpAppBridgeHandlers;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

const TEARDOWN_WAIT_MS = 500;

function isJsonRpc(value: unknown): value is JsonRpcMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0"
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** `ui/message` content: one text block, or (in later drafts) an array. */
export function mcpAppMessageText(params: unknown): string {
  const content = record(params).content;
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .map((block) => {
      const entry = record(block);
      return entry.type === "text" && typeof entry.text === "string"
        ? entry.text
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The call result a view expects, from what YA kept: the live result is the
 * provider's JSON `CallToolResult`; replayed history keeps only its text.
 */
export function mcpAppToolResult(
  content: string,
  isError: boolean,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(record(parsed).content)) {
      const result = record(parsed);
      return {
        content: result.content,
        ...(result.structuredContent != null
          ? { structuredContent: result.structuredContent }
          : {}),
        ...(result._meta != null ? { _meta: result._meta } : {}),
        ...(isError ? { isError: true } : {}),
      };
    }
  } catch {
    // Plain text output.
  }
  return {
    content: [{ type: "text", text: content }],
    ...(isError ? { isError: true } : {}),
  };
}

export class McpAppBridge {
  private resourceSent = false;
  private initialized = false;
  private toolResult: Record<string, unknown> | undefined;
  private toolResultSent = false;
  private cancelledReason: string | undefined;
  private nextId = 1;
  private readonly pending = new Map<string | number, () => void>();

  constructor(private readonly options: McpAppBridgeOptions) {}

  handleMessage(event: MessageEvent): void {
    const frame = this.options.frame();
    if (
      !frame ||
      event.source !== frame ||
      event.origin !== this.options.proxyOrigin
    )
      return;
    const message = event.data;
    if (!isJsonRpc(message)) return;
    if (typeof message.method === "string") {
      if (message.id !== undefined && message.id !== null) {
        void this.handleRequest(message.id, message.method, message.params);
      } else {
        this.handleNotification(message.method, message.params);
      }
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      this.pending.get(message.id)?.();
      this.pending.delete(message.id);
    }
  }

  /** The originating call finished; delivered once, after initialization. */
  setToolResult(result: Record<string, unknown>): void {
    if (this.toolResult) return;
    this.toolResult = result;
    this.flushOutcome();
  }

  setCancelled(reason: string): void {
    if (this.toolResult || this.cancelledReason) return;
    this.cancelledReason = reason;
    this.flushOutcome();
  }

  setHostContext(partial: Record<string, unknown>): void {
    Object.assign(this.options.hostContext, partial);
    if (this.initialized)
      this.notify("ui/notifications/host-context-changed", partial);
  }

  /** Ask the view to finish, waiting briefly so it can save its state. */
  teardown(reason: string): Promise<void> {
    if (!this.initialized) return Promise.resolve();
    const id = `teardown-${this.nextId++}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve();
      }, TEARDOWN_WAIT_MS);
      this.pending.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      this.post({
        jsonrpc: "2.0",
        id,
        method: "ui/resource-teardown",
        params: { reason },
      });
    });
  }

  private post(message: JsonRpcMessage): void {
    this.options.frame()?.postMessage(message, this.options.proxyOrigin);
  }

  private notify(method: string, params: unknown): void {
    this.post({ jsonrpc: "2.0", method, params });
  }

  private flushOutcome(): void {
    if (!this.initialized || this.toolResultSent) return;
    if (this.toolResult) {
      this.toolResultSent = true;
      this.notify("ui/notifications/tool-result", this.toolResult);
    } else if (this.cancelledReason) {
      this.toolResultSent = true;
      this.notify("ui/notifications/tool-cancelled", {
        reason: this.cancelledReason,
      });
    }
  }

  private handleNotification(method: string, params: unknown): void {
    switch (method) {
      case "ui/notifications/sandbox-proxy-ready":
        if (this.resourceSent) return;
        this.resourceSent = true;
        this.notify("ui/notifications/sandbox-resource-ready", {
          html: this.options.html,
          csp: this.options.csp,
        });
        return;
      case "ui/notifications/initialized":
        if (this.initialized) return;
        this.initialized = true;
        this.notify("ui/notifications/tool-input", {
          arguments: record(this.options.toolInput),
        });
        this.flushOutcome();
        return;
      case "ui/notifications/size-changed": {
        const size = record(params);
        this.options.handlers.sizeChanged({
          ...(typeof size.width === "number" ? { width: size.width } : {}),
          ...(typeof size.height === "number" ? { height: size.height } : {}),
        });
        return;
      }
      default:
        // Logging and future notifications have no host effect.
        return;
    }
  }

  private async handleRequest(
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      this.post({
        jsonrpc: "2.0",
        id,
        result: await this.answer(method, record(params)),
      });
    } catch (error) {
      this.post({
        jsonrpc: "2.0",
        id,
        error: {
          code: error instanceof MethodNotFound ? -32601 : -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async answer(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const { handlers } = this.options;
    switch (method) {
      case "ui/initialize":
        return {
          protocolVersion: MCP_APP_PROTOCOL_VERSION,
          hostCapabilities: {
            openLinks: {},
            serverTools: {},
            serverResources: {},
            sandbox: { csp: this.options.csp },
          },
          hostInfo: { name: "yep-anywhere", version: this.options.hostVersion },
          hostContext: this.options.hostContext,
        };
      case "ping":
        return {};
      case "tools/call": {
        if (typeof params.name !== "string" || !params.name)
          throw new Error("tools/call needs a tool name");
        const args = params.arguments;
        return handlers.callTool(
          params.name,
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : undefined,
        );
      }
      case "resources/read":
        if (typeof params.uri !== "string" || !params.uri)
          throw new Error("resources/read needs a uri");
        return handlers.readResource(params.uri);
      case "ui/open-link": {
        const url = typeof params.url === "string" ? params.url : "";
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("Invalid URL");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
          throw new Error("Only http and https links can be opened");
        handlers.openLink(parsed.href);
        return {};
      }
      case "ui/message": {
        const text = mcpAppMessageText(params);
        if (!text) throw new Error("Invalid message format");
        handlers.message(text);
        return {};
      }
      case "ui/update-model-context":
        await handlers.updateModelContext(params);
        return {};
      case "ui/request-display-mode":
        return {
          mode: handlers.requestDisplayMode(
            typeof params.mode === "string" ? params.mode : "",
          ),
        };
      default:
        throw new MethodNotFound(method);
    }
  }
}

class MethodNotFound extends Error {
  constructor(method: string) {
    super(`Unsupported method ${method}`);
  }
}
