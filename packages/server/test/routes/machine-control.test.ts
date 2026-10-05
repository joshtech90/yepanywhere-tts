import { describe, expect, it, vi } from "vitest";
import { createMachineControlRoutes } from "../../src/routes/machine-control.js";
import type { InstalledMachineControl } from "../../src/machine-control/installation.js";

const installation: InstalledMachineControl = {
  root: "/fixture/mc-cli",
  directory: "/fixture/mc-cli/commands",
  command: "/fixture/mc-cli/commands/machine-control",
  python: "/fixture/python",
  version: "0.5.3",
  sourceRevision: "a".repeat(40),
};

describe("installed MC readiness", () => {
  it.each(["GET", "POST", "PUT", "DELETE"])(
    "refuses retired operations without installation work (%s)",
    async (method) => {
      const verify = vi.fn();
      const routes = createMachineControlRoutes({ verify });
      const response = await routes.request(
        "/computer-control/releases/update",
        { method },
      );
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({
        error: expect.stringContaining("legacy component is retired"),
      });
      expect(verify).not.toHaveBeenCalled();
    },
  );
  it.each(["darwin", "win32", "linux"])(
    "verifies configured %s installations without enabling launch advertisement",
    async (platform) => {
      const verify = vi.fn().mockResolvedValue(installation);
      const routes = createMachineControlRoutes({
        platform,
        environment: {
          YEP_MC_APP: "configured product",
          YEP_MC_TEAM_ID: "trusted team",
          YEP_MC_PUBLISHER: "trusted publisher",
          YEP_MC_CONTROL: "0",
        },
        verify,
      });
      const response = await routes.request("/machine-control");
      expect(await response.json()).toEqual({
        available: true,
        version: "0.5.3",
      });
      expect(verify).toHaveBeenCalledWith(
        "configured product",
        platform === "darwin" ? "trusted team" : "trusted publisher",
        platform,
      );
    },
  );
  it("returns bounded optional unavailability without leaking verification details", async () => {
    const routes = createMachineControlRoutes({
      platform: "linux",
      environment: {},
      verify: async () => {
        throw new Error("private path and signing detail");
      },
    });
    const response = await routes.request("/machine-control");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      reason: "installation-unavailable",
    });
  });
  it("does not execute an installation probe on unsupported hosts", async () => {
    const verify = vi.fn();
    const routes = createMachineControlRoutes({ platform: "freebsd", verify });
    expect(await (await routes.request("/machine-control")).json()).toEqual({
      available: false,
      reason: "unsupported-host",
    });
    expect(verify).not.toHaveBeenCalled();
  });
});
