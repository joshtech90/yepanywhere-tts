import { describe, expect, it } from "vitest";
import { cockpitLedToneForState, cockpitLedToneForStatus } from "./statusLed";

describe("cockpit status LED", () => {
  it("maps list statuses to the shared colour language", () => {
    expect(cockpitLedToneForStatus("complete")).toBe("idle");
    expect(cockpitLedToneForStatus("active")).toBe("working");
    expect(cockpitLedToneForStatus("external")).toBe("working");
    expect(cockpitLedToneForStatus("approval")).toBe("waiting");
    expect(cockpitLedToneForStatus("question")).toBe("waiting");
    expect(cockpitLedToneForStatus("error")).toBe("error");
    expect(cockpitLedToneForStatus("offline")).toBe("unknown");
  });

  it("maps the open session's state to the same colours", () => {
    expect(cockpitLedToneForState("complete")).toBe("idle");
    expect(cockpitLedToneForState("active")).toBe("working");
    expect(cockpitLedToneForState("external")).toBe("working");
    expect(cockpitLedToneForState("waiting")).toBe("waiting");
    expect(cockpitLedToneForState("error")).toBe("error");
    expect(cockpitLedToneForState("reconnecting")).toBe("unknown");
    expect(cockpitLedToneForState("offline")).toBe("unknown");
  });
});
