import type { ContextBreakdown } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createContextBreakdownRoutes } from "../../src/routes/context-breakdown.js";
import type { Process } from "../../src/supervisor/Process.js";

const BREAKDOWN: ContextBreakdown = {
  model: "claude-sonnet-5",
  totalTokens: 1000,
  maxTokens: 200000,
  categories: [
    { key: "messages", name: "Messages", tokens: 1000, kind: "used" },
  ],
};

function appFor(process: Pick<Process, "getContextBreakdown"> | undefined) {
  const app = new Hono();
  app.route(
    "/api/sessions",
    createContextBreakdownRoutes({
      supervisor: {
        getProcessForSession: (sessionId: string) =>
          sessionId === "live" ? (process as Process | undefined) : undefined,
      },
    }),
  );
  return app;
}

describe("context breakdown route", () => {
  it("returns the live process's breakdown", async () => {
    const response = await appFor({
      getContextBreakdown: async () => BREAKDOWN,
    }).request("/api/sessions/live/context-breakdown");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ breakdown: BREAKDOWN });
  });

  it("returns null without a live process or provider support", async () => {
    const noProcess = await appFor(undefined).request(
      "/api/sessions/idle/context-breakdown",
    );
    expect(await noProcess.json()).toEqual({ breakdown: null });

    const unsupported = await appFor({
      getContextBreakdown: async () => null,
    }).request("/api/sessions/live/context-breakdown");
    expect(await unsupported.json()).toEqual({ breakdown: null });
  });

  it("reports a provider failure as 502 with its message", async () => {
    const response = await appFor({
      getContextBreakdown: async () => {
        throw new Error("token count unavailable");
      },
    }).request("/api/sessions/live/context-breakdown");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "token count unavailable",
    });
  });
});
