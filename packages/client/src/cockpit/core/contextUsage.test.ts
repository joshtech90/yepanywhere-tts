import { describe, expect, it } from "vitest";
import { cockpitContextUsage } from "./contextUsage";

describe("cockpitContextUsage", () => {
  it("shows the percentage within a known window", () => {
    expect(
      cockpitContextUsage(
        { inputTokens: 29963, percentage: 15, contextWindow: 200000 },
        "de",
      ),
    ).toEqual({
      percent: 15,
      used: "29.963",
      short: "30k",
      window: "200.000",
    });
  });

  it("falls back to the token count when the window is too small", () => {
    const view = cockpitContextUsage(
      { inputTokens: 353612, percentage: 177, contextWindow: 200000 },
      "de",
    );
    expect(view?.percent).toBeNull();
    expect(view?.short).toBe("354k");
  });

  it("shows nothing without usage", () => {
    expect(cockpitContextUsage(undefined, "de")).toBeNull();
    expect(
      cockpitContextUsage({ inputTokens: 0, percentage: 0 }, "de"),
    ).toBeNull();
  });
});
