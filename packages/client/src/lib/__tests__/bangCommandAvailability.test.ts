import { describe, expect, it } from "vitest";
import { bangHistoryViewEnabled } from "../bangCommandAvailability";

describe("bang command history opt-in", () => {
  it("stays default-off independently of server capability negotiation", () => {
    expect(bangHistoryViewEnabled()).toBe(false);
    expect(bangHistoryViewEnabled({ bangCommandsEnabled: false })).toBe(false);
    expect(bangHistoryViewEnabled({ bangCommandsEnabled: true })).toBe(true);
  });
});
