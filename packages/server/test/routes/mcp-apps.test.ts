import type { McpAppProviderRequest } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpAppRoutes,
  parseMcpAppHostRequest,
} from "../../src/routes/mcpApps.js";
import type { Process } from "../../src/supervisor/Process.js";

const TOOLS = {
  refresh: { name: "refresh", _meta: { ui: { visibility: ["app"] } } },
  peek: { name: "peek", annotations: { readOnlyHint: true } },
  modelOnly: { name: "modelOnly", _meta: { ui: { visibility: ["model"] } } },
};

function fakeProcess(overrides: Partial<Process> = {}) {
  const calls: McpAppProviderRequest[] = [];
  const process = {
    supportsMcpApps: true,
    sandboxEnforcement: undefined,
    permissionMode: "default",
    mcpAppRequest: vi.fn(async (request: McpAppProviderRequest) => {
      calls.push(request);
      if (request.kind === "listTools") return TOOLS;
      if (request.kind === "callTool")
        return { content: [{ type: "text", text: "ok" }] };
      return { contents: [] };
    }),
    ...overrides,
  } as unknown as Process;
  return { process, calls };
}

function appFor(process: Process | undefined, enabled = true) {
  const app = new Hono();
  app.route(
    "/api",
    createMcpAppRoutes({
      getProcessForSession: () => process,
      isEnabled: () => enabled,
    }),
  );
  return (body: unknown) =>
    app.request("/api/projects/p/sessions/s/mcp-apps", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
}

describe("MCP App request route", () => {
  it("refuses while views are off, without a running session, or sandboxed", async () => {
    const { process } = fakeProcess();
    const read = { kind: "readResource", server: "w", uri: "ui://w/v" };
    expect((await appFor(process, false)(read)).status).toBe(409);
    const missing = await appFor(undefined)(read);
    expect(await missing.json()).toMatchObject({
      reason: "session-not-running",
    });
    const sandboxed = fakeProcess({
      sandboxEnforcement: {
        state: "enforced",
      } as Process["sandboxEnforcement"],
    });
    expect(await (await appFor(sandboxed.process)(read)).json()).toMatchObject({
      reason: "sandboxed",
    });
    expect(sandboxed.calls).toEqual([]);
  });

  it("rejects tools hidden from apps and asks before a writing tool", async () => {
    const { process, calls } = fakeProcess();
    const call = appFor(process);
    const hidden = await call({
      kind: "callTool",
      server: "w",
      tool: "modelOnly",
    });
    expect(hidden.status).toBe(403);
    expect(
      await (
        await call({ kind: "callTool", server: "w", tool: "refresh" })
      ).json(),
    ).toEqual({ approvalRequired: true, toolTitle: "refresh" });
    expect(calls.filter((request) => request.kind === "callTool")).toEqual([]);

    const approved = await call({
      kind: "callTool",
      server: "w",
      tool: "refresh",
      arguments: { a: 1 },
      approved: true,
    });
    expect(await approved.json()).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    expect(calls.at(-1)).toEqual({
      kind: "callTool",
      server: "w",
      tool: "refresh",
      arguments: { a: 1 },
    });
  });

  it("runs read-only tools, or any tool when the session bypasses approvals", async () => {
    const readOnly = fakeProcess();
    await appFor(readOnly.process)({
      kind: "callTool",
      server: "w",
      tool: "peek",
    });
    expect(readOnly.calls.at(-1)).toMatchObject({
      kind: "callTool",
      tool: "peek",
    });
    const bypass = fakeProcess({
      permissionMode: "bypassPermissions",
    } as Partial<Process>);
    await appFor(bypass.process)({
      kind: "callTool",
      server: "w",
      tool: "refresh",
    });
    expect(bypass.calls.at(-1)).toMatchObject({
      kind: "callTool",
      tool: "refresh",
    });
  });

  it("validates request shapes", () => {
    expect(parseMcpAppHostRequest({ kind: "callTool", server: "w" })).toBe(
      undefined,
    );
    expect(
      parseMcpAppHostRequest({
        kind: "callTool",
        server: "w",
        tool: "t",
        arguments: [1],
      }),
    ).toBe(undefined);
    expect(
      parseMcpAppHostRequest({
        kind: "updateModelContext",
        key: "k",
        server: "w",
        tool: "t",
        text: null,
      }),
    ).toEqual({
      kind: "updateModelContext",
      key: "k",
      server: "w",
      tool: "t",
      text: null,
    });
    expect(parseMcpAppHostRequest({ kind: "other", server: "w" })).toBe(
      undefined,
    );
  });
});
