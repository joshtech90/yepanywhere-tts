import { describe, expect, it } from "vitest";
import {
  applyStandingPermissionMode,
  resolveStandingPermissionMode,
  setStandingPermissionModeSource,
} from "../../src/supervisor/standingPermissionMode.js";

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

describe("applyStandingPermissionMode", () => {
  it("follows the configured standing default at runtime", () => {
    let standing: "bypassPermissions" | undefined = "bypassPermissions";
    setStandingPermissionModeSource(() => standing);
    try {
      expect(applyStandingPermissionMode("default")).toBe("bypassPermissions");
      expect(applyStandingPermissionMode(undefined)).toBe("bypassPermissions");
      expect(applyStandingPermissionMode("plan")).toBe("plan");
      standing = undefined;
      expect(applyStandingPermissionMode("default")).toBe("default");
    } finally {
      setStandingPermissionModeSource(undefined);
    }
  });
});
