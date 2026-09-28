import { describe, expect, it } from "vitest";
import { displayModelId } from "../model-display.js";

describe("displayModelId", () => {
  it("drops the vendor name the provider already implies", () => {
    expect(displayModelId("claude-opus-5-5")).toBe("opus-5-5");
    expect(displayModelId("claude-haiku-4-5")).toBe("haiku-4-5");
  });

  it("leaves ids whose prefix names the model family", () => {
    // "gpt" is the family, not a vendor name that could be dropped.
    expect(displayModelId("gpt-6-astra")).toBe("gpt-6-astra");
    expect(displayModelId("opus")).toBe("opus");
  });
});
