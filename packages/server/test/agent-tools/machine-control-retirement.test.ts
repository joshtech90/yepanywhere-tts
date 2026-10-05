import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  retireLegacyComputerControl,
  type LegacyComputerSettings,
} from "../../src/machine-control/legacy-retirement.js";
import type {
  ServerSettings,
  ServerSettingsService,
} from "../../src/services/ServerSettingsService.js";

const dataDir = "C:\\Example\\YA";
const instance = `ya-${createHash("sha256").update(dataDir).digest("hex").slice(0, 20)}`;
const root = "C:\\Example\\Local";
const preview = {
  packageDirectory: `${root}\\MachineControl\\packages\\${instance}\\versions\\${"a".repeat(64)}`,
  trustedPublisher: "Example Publisher",
};
function fixture(value?: LegacyComputerSettings) {
  let config = value;
  return {
    getSetting: vi.fn(
      () => config,
    ) as unknown as ServerSettingsService["getSetting"],
    updateSettings: vi.fn(async (next: Partial<ServerSettings>) => {
      config = next.computerControl;
      return {};
    }) as unknown as ServerSettingsService["updateSettings"],
    read: () => config,
  };
}
const legacy = {
  enabled: true,
  autoUpdate: true,
  idleMs: 60_000,
  grantMs: 60_000,
};
describe("retired YA workstation component", () => {
  it("does nothing to an installation without old settings", async () => {
    const settings = fixture();
    const run = vi.fn();
    expect(
      await retireLegacyComputerControl(settings, dataDir, { run }),
    ).toEqual({ state: "absent" });
    expect(settings.updateSettings).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("removes old enablement without opting in to desktop MC", async () => {
    const settings = fixture(legacy);
    expect(await retireLegacyComputerControl(settings, dataDir)).toEqual({
      state: "removed",
    });
    expect(settings.read()).toBeUndefined();
    expect(settings.updateSettings).toHaveBeenNthCalledWith(1, {
      computerControl: { ...legacy, enabled: false, autoUpdate: false },
    });
  });
  it.each(["desktop", "another-ya-instance", "../../outside"])(
    "refuses a foreign or unsafe locator %s",
    async (name) => {
      const settings = fixture({
        ...legacy,
        preview: {
          ...preview,
          packageDirectory: `${root}\\MachineControl\\packages\\${name}\\versions\\${"a".repeat(64)}`,
        },
      });
      const run = vi.fn();
      expect(
        await retireLegacyComputerControl(settings, dataDir, {
          platform: "win32",
          environment: { LOCALAPPDATA: root },
          run,
        }),
      ).toEqual({ state: "pending", reason: "cleanup-failed" });
      expect(run).not.toHaveBeenCalled();
      expect(settings.read()).toMatchObject({
        enabled: false,
        autoUpdate: false,
        preview: expect.any(Object),
      });
    },
  );
  it("retains disabled cleanup metadata on another host", async () => {
    const settings = fixture({ ...legacy, preview });
    const run = vi.fn();
    expect(
      await retireLegacyComputerControl(settings, dataDir, {
        platform: "linux",
        run,
      }),
    ).toEqual({ state: "pending", reason: "unsupported-host" });
    expect(run).not.toHaveBeenCalled();
    expect(settings.read()).toMatchObject({ enabled: false, preview });
  });
  it("retains and retries failed cleanup, clearing metadata only on success", async () => {
    const settings = fixture({ ...legacy, preview });
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("secret/private path"))
      .mockResolvedValueOnce('{"removed":true}');
    const dependencies = {
      platform: "win32" as const,
      environment: { LOCALAPPDATA: root },
      run,
    };
    expect(
      await retireLegacyComputerControl(settings, dataDir, dependencies),
    ).toEqual({ state: "pending", reason: "cleanup-failed" });
    expect(settings.read()).toMatchObject({
      enabled: false,
      autoUpdate: false,
      preview,
    });
    expect(
      await retireLegacyComputerControl(settings, dataDir, dependencies),
    ).toEqual({ state: "removed" });
    expect(settings.read()).toBeUndefined();
    const input = JSON.parse(run.mock.calls[1]![2]);
    expect(input).toEqual({ ...preview, instance, packageId: "a".repeat(64) });
  });
});
