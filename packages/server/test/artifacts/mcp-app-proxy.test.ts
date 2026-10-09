import { MCP_APP_PROXY_PATH } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import {
  mcpAppViewCsp,
  parseMcpAppCspParam,
} from "../../src/artifacts/mcpAppProxy.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";

describe("MCP App proxy policy", () => {
  it("is served on the artifact host with the view's policy as its header", async () => {
    const server = new ArtifactServer(
      { port: 4402, localOrigin: "http://artifacts.localhost:4402" },
      createLocalResourcePathPolicy({ allowedPaths: [] }),
    );
    const csp = encodeURIComponent(
      JSON.stringify({ connectDomains: ["https://api.example.com"] }),
    );
    const response = await server.app.request(
      `http://artifacts.localhost:4402${MCP_APP_PROXY_PATH}?host=http%3A%2F%2Flocalhost%3A3400&csp=${csp}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("sandbox-proxy-ready");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      mcpAppViewCsp({ connectDomains: ["https://api.example.com"] }),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("uses the spec's restrictive default when the view declares nothing", () => {
    const csp = mcpAppViewCsp({});
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("adds declared origins and drops anything that could inject a directive", () => {
    const csp = mcpAppViewCsp(
      parseMcpAppCspParam(
        JSON.stringify({
          connectDomains: [
            "https://api.example.com",
            "https://x.com; script-src *",
            "'unsafe-eval'",
          ],
          resourceDomains: ["https://*.cdn.example.com"],
        }),
      ),
    );
    expect(csp).toContain("connect-src https://api.example.com");
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://*.cdn.example.com",
    );
    expect(csp).not.toContain("x.com");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("treats a malformed parameter as no declared origins", () => {
    expect(parseMcpAppCspParam("{not json")).toEqual({});
    expect(mcpAppViewCsp(parseMcpAppCspParam(undefined))).toBe(
      mcpAppViewCsp({}),
    );
  });
});
