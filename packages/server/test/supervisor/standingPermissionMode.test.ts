import { describe, expect, it } from "vitest";
import { resolveStandingPermissionMode } from "../../src/supervisor/Supervisor.js";

describe("resolveStandingPermissionMode", () => {
  it("keeps a standing bypass when a resume asks for nothing or default", () => {
    expect(
      resolveStandingPermissionMode(undefined, "bypassPermissions", "default"),
    ).toBe("bypassPermissions");
    expect(
      resolveStandingPermissionMode("default", "bypassPermissions", "default"),
    ).toBe("bypassPermissions");
  });

  it("honours an explicit non-default choice", () => {
    expect(
      resolveStandingPermissionMode("plan", "bypassPermissions", "default"),
    ).toBe("plan");
    expect(
      resolveStandingPermissionMode(
        "acceptEdits",
        "bypassPermissions",
        "default",
      ),
    ).toBe("acceptEdits");
  });

  it("falls back as before without a standing bypass", () => {
    expect(resolveStandingPermissionMode(undefined, undefined, "default")).toBe(
      "default",
    );
    expect(resolveStandingPermissionMode("default", "plan", "default")).toBe(
      "default",
    );
    expect(resolveStandingPermissionMode(undefined, "plan", "default")).toBe(
      "plan",
    );
  });
});
