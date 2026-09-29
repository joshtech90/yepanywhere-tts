import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { countBusyProcesses } from "../src/routes/health.js";
import { MockClaudeSDK, MockServerClaudeProvider } from "../src/sdk/mock.js";
import { createApp } from "./setup/create-app.js";

describe("GET /health", () => {
  it("returns ok status", async () => {
    const res = await app.request("/health");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
    expect(json.timestamp).toBeDefined();
  });

  it("allows macOS Tauri desktop origin in the full app", async () => {
    const { app } = createApp({ sdk: new MockClaudeSDK() });
    const res = await app.request("/health", {
      headers: { Origin: "tauri://localhost" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "tauri://localhost",
    );
  });

  it("allows Windows Tauri desktop origin in the full app", async () => {
    const { app } = createApp({ sdk: new MockClaudeSDK() });
    const res = await app.request("/health", {
      headers: { Origin: "http://tauri.localhost" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://tauri.localhost",
    );
  });

  it("uses an explicit provider override for provider discovery", async () => {
    const { app } = createApp({ provider: new MockServerClaudeProvider() });
    const res = await app.request("/api/providers");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.providers).toEqual([
      expect.objectContaining({
        name: "claude",
        models: [{ id: "mock-model", name: "Mock Model" }],
      }),
    ]);
  });

  it("keeps isolated mock-SDK apps out of provider discovery", async () => {
    const { app } = createApp({ sdk: new MockClaudeSDK() });
    const res = await app.request("/api/providers");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ providers: [] });
  });
});

describe("GET /health/activity", () => {
  it("reports no busy sessions on a fresh server", async () => {
    const { app } = createApp({ sdk: new MockClaudeSDK() });
    const res = await app.request("/health/activity");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inTurn: 0, waitingInput: 0, busy: 0 });
  });

  it("counts turns and pending input but not idle or ended sessions", () => {
    const states = ["in-turn", "waiting-input", "idle", "terminated", "in-turn"];
    const counts = countBusyProcesses({
      getAllProcesses: () => states.map((type) => ({ state: { type } })),
    });

    expect(counts).toEqual({ inTurn: 2, waitingInput: 1, busy: 3 });
  });
});
