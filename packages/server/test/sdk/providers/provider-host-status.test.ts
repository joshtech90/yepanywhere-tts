import { afterEach, describe, expect, it } from "vitest";
import {
  isProviderHostDegraded,
  resetProviderHostDegradedForTests,
  setProviderHostDegraded,
} from "../../../src/sdk/providers/provider-host-status.js";

const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");

function runAsPlatform(platform: NodeJS.Platform, body: () => void): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    body();
  } finally {
    if (realPlatform) Object.defineProperty(process, "platform", realPlatform);
  }
}

describe("provider-host degraded notice", () => {
  afterEach(() => {
    resetProviderHostDegradedForTests();
  });

  it("stays off until boot records a failed ensure", () => {
    expect(isProviderHostDegraded()).toBe(false);
    setProviderHostDegraded(true);
    expect(isProviderHostDegraded()).toBe(true);
    setProviderHostDegraded(false);
    expect(isProviderHostDegraded()).toBe(false);
  });

  it("stores what it is told, leaving platform support to its caller", () => {
    runAsPlatform("win32", () => {
      setProviderHostDegraded(true);
      expect(isProviderHostDegraded()).toBe(true);
    });
  });
});
