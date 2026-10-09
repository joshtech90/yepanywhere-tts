import { describe, expect, it, vi } from "vitest";
import {
  McpAppBridge,
  type McpAppBridgeHandlers,
  mcpAppMessageText,
  mcpAppToolResult,
} from "../mcpAppBridge";

const PROXY_ORIGIN = "http://artifacts.localhost:3400";

function setup(overrides: Partial<McpAppBridgeHandlers> = {}) {
  const sent: unknown[] = [];
  const frame = {
    postMessage: vi.fn((message: unknown, origin: string) => {
      expect(origin).toBe(PROXY_ORIGIN);
      sent.push(message);
    }),
  } as unknown as Window;
  const handlers: McpAppBridgeHandlers = {
    callTool: vi.fn(async () => ({ content: [] })),
    readResource: vi.fn(async () => ({ contents: [] })),
    openLink: vi.fn(),
    message: vi.fn(),
    updateModelContext: vi.fn(async () => {}),
    requestDisplayMode: vi.fn(() => "fullscreen" as const),
    sizeChanged: vi.fn(),
    ...overrides,
  };
  const bridge = new McpAppBridge({
    frame: () => frame,
    proxyOrigin: PROXY_ORIGIN,
    html: "<p>view</p>",
    csp: { connectDomains: ["https://api.example.com"] },
    hostContext: { theme: "dark" },
    toolInput: { city: "Oslo" },
    hostVersion: "1",
    handlers,
  });
  const deliver = (data: unknown, origin = PROXY_ORIGIN, source = frame) =>
    bridge.handleMessage({ data, origin, source } as MessageEvent);
  return { bridge, sent, deliver, handlers, frame };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("McpAppBridge", () => {
  it("loads the view, then sends input and result only after initialization", async () => {
    const { bridge, sent, deliver } = setup();
    deliver({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" });
    expect(sent).toEqual([
      {
        jsonrpc: "2.0",
        method: "ui/notifications/sandbox-resource-ready",
        params: {
          html: "<p>view</p>",
          csp: { connectDomains: ["https://api.example.com"] },
        },
      },
    ]);
    bridge.setToolResult({ content: [{ type: "text", text: "sunny" }] });
    expect(sent).toHaveLength(1);

    deliver({ jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
    await flush();
    expect(sent[1]).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2026-01-26",
        hostContext: { theme: "dark" },
        hostCapabilities: { serverTools: {}, openLinks: {} },
      },
    });
    deliver({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    expect(sent.slice(2)).toEqual([
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: { city: "Oslo" } },
      },
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { content: [{ type: "text", text: "sunny" }] },
      },
    ]);
  });

  it("ignores messages from any other window or origin", () => {
    const { sent, deliver, frame } = setup();
    const proxyReady = {
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-proxy-ready",
    };
    deliver(proxyReady, "http://localhost:3400");
    deliver(proxyReady, PROXY_ORIGIN, {} as Window);
    expect(sent).toEqual([]);
    deliver(proxyReady, PROXY_ORIGIN, frame);
    expect(sent).toHaveLength(1);
  });

  it("routes view requests to their handlers and reports failures", async () => {
    const { sent, deliver, handlers } = setup({
      callTool: vi.fn(async () => {
        throw new Error("The reader declined");
      }),
    });
    deliver({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "refresh", arguments: { a: 1 } },
    });
    deliver({
      jsonrpc: "2.0",
      id: 3,
      method: "ui/open-link",
      params: { url: "javascript:alert(1)" },
    });
    deliver({
      jsonrpc: "2.0",
      id: 4,
      method: "ui/message",
      params: { role: "user", content: { type: "text", text: "hi" } },
    });
    deliver({ jsonrpc: "2.0", id: 5, method: "no/such" });
    await flush();
    expect(handlers.callTool).toHaveBeenCalledWith("refresh", { a: 1 });
    expect(handlers.openLink).not.toHaveBeenCalled();
    expect(handlers.message).toHaveBeenCalledWith("hi");
    expect(sent).toEqual(
      expect.arrayContaining([
        {
          jsonrpc: "2.0",
          id: 2,
          error: { code: -32000, message: "The reader declined" },
        },
        expect.objectContaining({ id: 3, error: expect.anything() }),
        { jsonrpc: "2.0", id: 4, result: {} },
        expect.objectContaining({
          id: 5,
          error: expect.objectContaining({ code: -32601 }),
        }),
      ]),
    );
  });

  it("derives a call result from live JSON or replayed text", () => {
    expect(
      mcpAppToolResult(
        JSON.stringify({
          content: [{ type: "text", text: "x" }],
          structuredContent: { n: 1 },
          _meta: null,
        }),
        false,
      ),
    ).toEqual({
      content: [{ type: "text", text: "x" }],
      structuredContent: { n: 1 },
    });
    expect(mcpAppToolResult("plain", true)).toEqual({
      content: [{ type: "text", text: "plain" }],
      isError: true,
    });
    expect(
      mcpAppMessageText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\n\nb");
  });
});
