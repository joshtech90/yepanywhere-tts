import { join } from "node:path";
import {
  MCP_APP_PROXY_DOCUMENT,
  mcpAppViewCsp,
  parseMcpAppCspParam,
} from "../../server/src/artifacts/mcpAppProxy";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

/**
 * An MCP App view crosses three browsing contexts — the YA page, the sandbox
 * proxy on the artifact origin, and the view's opaque `srcdoc` frame — so only
 * a real browser shows the bridge working. The session, settings and view
 * route are mocked; the proxy is the server's own document and policy.
 * Contract: topics/mcp-apps.md
 */

const ARTIFACT_ORIGIN = "http://artifacts.localhost:4999";

const VIEW_HTML = `<!doctype html><body style="font:14px system-ui;margin:8px">
<p id="out">waiting</p><button id="refresh">Refresh</button> <button id="ask">Plan a trip</button>
<script>
let id = 0; const pending = {}; let input;
const rpc = (method, params) => new Promise((resolve, reject) => {
  const i = ++id; pending[i] = { resolve, reject };
  parent.postMessage({ jsonrpc: "2.0", id: i, method, params }, "*");
});
const out = (text) => { document.getElementById("out").textContent = text; };
addEventListener("message", (event) => {
  const m = event.data;
  if (m.id && pending[m.id]) { m.error ? pending[m.id].reject(m.error) : pending[m.id].resolve(m.result); delete pending[m.id]; return; }
  if (m.method === "ui/notifications/tool-input") input = m.params.arguments;
  if (m.method === "ui/notifications/tool-result") {
    let storage = "open"; try { localStorage.length; } catch (error) { storage = "sealed"; }
    out(input.city + ": " + m.params.content[0].text + " (" + storage + ")");
  }
});
document.getElementById("refresh").onclick = () =>
  rpc("tools/call", { name: "refresh", arguments: {} }).then((r) => out(r.content[0].text), () => out("denied"));
document.getElementById("ask").onclick = async () => {
  await rpc("ui/update-model-context", { content: [{ type: "text", text: "Viewing Oslo" }] });
  await rpc("ui/message", { role: "user", content: { type: "text", text: "Plan a trip to Oslo" } });
};
rpc("ui/initialize", { appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] }, protocolVersion: "2026-01-26" })
  .then(() => parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*"));
</script>`;

for (const viewport of [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
]) {
  test(`MCP App view runs through the proxy at ${viewport.name} width`, async ({
    page,
    baseURL,
  }) => {
    const projectId = Buffer.from(
      join(e2ePaths.tempDir, "mockproject"),
    ).toString("base64url");
    const sessionId = "mcp-app-session";
    const timestamp = new Date().toISOString();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.route("**/api/version*", async (route) => {
      const real = await (await route.fetch()).json();
      await route.fulfill({
        json: {
          ...real,
          artifactViewer: {
            ...real.artifactViewer,
            localOrigin: ARTIFACT_ORIGIN,
          },
        },
      });
    });
    await page.route(/\/api\/settings(?:\?|$)/, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const real = await (await route.fetch()).json();
      await route.fulfill({
        json: { ...real, settings: { ...real.settings, mcpAppViews: true } },
      });
    });
    await page.route(`${ARTIFACT_ORIGIN}/.yep/mcp-app-proxy*`, (route) => {
      const csp = new URL(route.request().url()).searchParams.get("csp");
      return route.fulfill({
        contentType: "text/html",
        headers: {
          "Content-Security-Policy": mcpAppViewCsp(
            parseMcpAppCspParam(csp ?? undefined),
          ),
        },
        body: MCP_APP_PROXY_DOCUMENT,
      });
    });
    const requests: Array<Record<string, unknown>> = [];
    await page.route("**/api/projects/*/sessions/*/mcp-apps", (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(body);
      if (body.kind === "readResource")
        return route.fulfill({
          json: {
            contents: [
              {
                uri: "ui://weather/forecast",
                mimeType: "text/html;profile=mcp-app",
                text: VIEW_HTML,
              },
            ],
          },
        });
      if (body.kind === "callTool")
        return route.fulfill({
          json:
            body.approved === true
              ? { content: [{ type: "text", text: "Refreshed: rain" }] }
              : { approvalRequired: true, toolTitle: "Refresh forecast" },
        });
      return route.fulfill({ json: true });
    });
    await page.route(
      new RegExp(
        `/api/projects/[^/]+/sessions/${sessionId}(?:/metadata)?(?:\\?|$)`,
      ),
      (route) =>
        route.fulfill({
          json: {
            session: {
              id: sessionId,
              projectId,
              provider: "codex",
              title: "MCP App view",
              createdAt: timestamp,
              updatedAt: timestamp,
              ownership: { owner: "none" },
              messageCount: 3,
            },
            ownership: { owner: "none" },
            processState: "idle",
            messages: [
              {
                id: "prompt",
                uuid: "prompt",
                type: "user",
                content: "What is the weather in Oslo?",
                timestamp,
              },
              {
                id: "call",
                uuid: "call",
                type: "assistant",
                timestamp,
                message: {
                  role: "assistant",
                  content: [
                    {
                      type: "tool_use",
                      id: "call-1",
                      name: "weather:forecast",
                      input: { city: "Oslo" },
                      _mcpApp: {
                        server: "weather",
                        tool: "forecast",
                        resourceUri: "ui://weather/forecast",
                        displayMode: "inline",
                      },
                    },
                  ],
                },
              },
              {
                id: "result",
                uuid: "result",
                type: "user",
                timestamp,
                message: {
                  role: "user",
                  content: [
                    {
                      type: "tool_result",
                      tool_use_id: "call-1",
                      content: JSON.stringify({
                        content: [{ type: "text", text: "Sunny" }],
                        structuredContent: { celsius: 21 },
                      }),
                    },
                  ],
                },
              },
            ],
          },
        }),
    );

    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
    await page.getByRole("button", { name: "Show app view" }).click();
    const view = page
      .frameLocator('iframe[title="weather forecast app view"]')
      .frameLocator("iframe");
    await test.step("the view receives input and result in an opaque origin", async () => {
      await expect(view.locator("#out")).toHaveText("Oslo: Sunny (sealed)");
    });

    await test.step("a writing tool call waits for the reader", async () => {
      await view.locator("#refresh").click();
      await page.getByRole("button", { name: "Allow once" }).click();
      await expect(view.locator("#out")).toHaveText("Refreshed: rain");
      expect(requests.filter((request) => request.kind === "callTool")).toEqual(
        [
          {
            kind: "callTool",
            server: "weather",
            tool: "refresh",
            arguments: {},
            approved: false,
          },
          {
            kind: "callTool",
            server: "weather",
            tool: "refresh",
            arguments: {},
            approved: true,
          },
        ],
      );
    });

    const composer = page.locator("[data-composer-input]");
    await test.step("a view message fills the draft without sending", async () => {
      await view.locator("#ask").click();
      await expect(composer).toHaveValue(/Plan a trip to Oslo/);
      expect(requests).toContainEqual({
        kind: "updateModelContext",
        key: "call-1",
        server: "weather",
        tool: "forecast",
        text: "Viewing Oslo",
      });
    });

    await test.step("typing stays immediate while the view is live", async () => {
      await composer.fill("");
      await composer.click();
      let typed = "";
      for (const character of "Sounds good") {
        await composer.pressSequentially(character);
        typed += character;
        await expect(composer).toHaveValue(typed, { timeout: 100 });
      }
    });
    await recordUiCapture(
      page,
      `mcp-app-view-inline-${viewport.name}`,
      viewport,
    );

    await test.step("Expand moves the view to the session panel", async () => {
      await page
        .locator('[data-mcp-app-card="call-1"]')
        .getByRole("button", { name: "Expand" })
        .click();
      await expect(view.locator("#out")).toHaveText("Oslo: Sunny (sealed)");
    });
    await recordUiCapture(
      page,
      `mcp-app-view-panel-${viewport.name}`,
      viewport,
    );
    expect(errors).toEqual([]);
  });
}
