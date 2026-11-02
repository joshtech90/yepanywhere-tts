import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { GeminiACPProvider } from "../../../src/sdk/providers/gemini-acp.js";

afterEach(() => vi.unstubAllEnvs());

it("offers and authenticates the gateway's Gemini models without OAuth", async () => {
  const server = createServer((req, res) => {
    expect(req.url).toBe("/v1beta/models");
    expect(req.headers["x-goog-api-key"]).toBe("test-gateway-key");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        models: [
          { name: "models/gemini-flash-high", displayName: "Gemini Flash" },
          { name: "models/claude-opus" },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", `http://127.0.0.1:${address.port}`);
    vi.stubEnv("GEMINI_API_KEY", "test-gateway-key");
    const provider = new GeminiACPProvider({ geminiPath: process.execPath });
    expect(await provider.getAuthStatus()).toMatchObject({
      authenticated: true,
    });
    expect(await provider.getAvailableModels()).toEqual([
      { id: "gemini-flash-high", name: "Gemini Flash" },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

it("does not advertise unavailable OAuth models when the gateway fails", async () => {
  vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("GEMINI_API_KEY", "test-gateway-key");
  expect(await new GeminiACPProvider().getAvailableModels()).toEqual([]);
});
