import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookup, exists } = vi.hoisted(() => ({
  lookup: vi.fn(),
  exists: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: lookup,
  }),
}));
vi.mock("node:fs", () => ({ existsSync: exists }));
vi.mock("node:os", () => ({
  platform: () => "win32",
  homedir: () => "/fixture/home",
}));

import { detectAdb } from "../../src/device/adb.js";

beforeEach(() => {
  lookup.mockReset();
  exists.mockReset().mockReturnValue(false);
});

describe("ADB discovery", () => {
  it("uses the first PATH match and strips Windows line endings", async () => {
    lookup.mockResolvedValue({
      stdout: "C:\\Android\\adb.exe\r\nD:\\adb.exe\r\n",
    });
    expect(await detectAdb()).toBe("C:\\Android\\adb.exe");
    expect(exists).not.toHaveBeenCalled();
  });

  it("keeps the event loop available while a bounded lookup is pending", async () => {
    let complete!: (value: { stdout: string }) => void;
    lookup.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const detection = detectAdb();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lookup).toHaveBeenCalledWith("where.exe", ["adb"], {
      encoding: "utf-8",
      timeout: 5_000,
      windowsHide: true,
    });
    complete({ stdout: "C:\\Android\\adb.exe\r\n" });
    expect(await detection).toBe("C:\\Android\\adb.exe");
  });

  it.each(["ENOENT", "ETIMEDOUT"])(
    "falls back to SDK locations when PATH lookup fails with %s",
    async (code) => {
      lookup.mockRejectedValue(Object.assign(new Error(code), { code }));
      const sdkAdb = path.join(
        "/fixture/home",
        "AppData",
        "Local",
        "Android",
        "Sdk",
        "platform-tools",
        "adb.exe",
      );
      exists.mockImplementation((candidate) => candidate === sdkAdb);
      expect(await detectAdb()).toBe(sdkAdb);
    },
  );

  it("disables the optional bridge when no installation is found", async () => {
    lookup.mockResolvedValue({ stdout: "" });
    expect(await detectAdb()).toBeNull();
  });
});
