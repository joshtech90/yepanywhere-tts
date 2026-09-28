import {
  SESSION_SANDBOXING_CAPABILITY,
  SESSION_SANDBOXING_STATUS_CAPABILITY,
  SESSION_SANDBOX_NETWORK_FIREWALL_CAPABILITY,
} from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  describeUnavailableSessionSandbox,
  type SessionSandboxAvailabilitySource,
  serverHasAvailableSessionSandbox,
} from "../sessionSandboxAvailability";

describe("serverHasAvailableSessionSandbox", () => {
  it("requires the status contract, usable capability, and available state", () => {
    expect(
      serverHasAvailableSessionSandbox({
        capabilities: [
          SESSION_SANDBOXING_CAPABILITY,
          SESSION_SANDBOXING_STATUS_CAPABILITY,
          SESSION_SANDBOX_NETWORK_FIREWALL_CAPABILITY,
        ],
        sessionSandboxing: {
          state: "available",
          platform: "linux",
          backend: "bubblewrap",
          version: "0.4.0",
        },
      }),
    ).toBe(true);
  });

  it.each([
    {
      capabilities: [SESSION_SANDBOXING_CAPABILITY],
      sessionSandboxing: undefined,
    },
    {
      capabilities: [SESSION_SANDBOXING_STATUS_CAPABILITY],
      sessionSandboxing: {
        state: "unsupported-platform" as const,
        platform: "darwin",
      },
    },
    {
      capabilities: [
        SESSION_SANDBOXING_CAPABILITY,
        SESSION_SANDBOXING_STATUS_CAPABILITY,
      ],
      sessionSandboxing: {
        state: "available" as const,
        platform: "linux",
        backend: "bubblewrap" as const,
      },
    },
    {
      capabilities: [
        SESSION_SANDBOXING_CAPABILITY,
        SESSION_SANDBOXING_STATUS_CAPABILITY,
        SESSION_SANDBOX_NETWORK_FIREWALL_CAPABILITY,
      ],
      sessionSandboxing: {
        state: "probe-failed" as const,
        platform: "linux",
        backend: "bubblewrap" as const,
      },
    },
  ])("rejects an unavailable or incomplete advertisement", (source) => {
    expect(serverHasAvailableSessionSandbox(source)).toBe(false);
  });
});

describe("describeUnavailableSessionSandbox", () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key;
  const linux = (
    sessionSandboxing: SessionSandboxAvailabilitySource["sessionSandboxing"],
  ): SessionSandboxAvailabilitySource => ({
    capabilities: [SESSION_SANDBOXING_STATUS_CAPABILITY],
    sessionSandboxing,
  });

  it("names the packages to install", () => {
    expect(
      describeUnavailableSessionSandbox(
        linux({
          state: "probe-failed",
          platform: "linux",
          blocker: {
            kind: "missing-packages",
            packages: ["slirp4netns", "iproute2"],
          },
        }),
        t,
      ),
    ).toBe(
      'newSessionSandboxUnavailableMissingPackages {"packages":"slirp4netns, iproute2"}',
    );
  });

  it("names Bubblewrap for a server without the blocker field", () => {
    expect(
      describeUnavailableSessionSandbox(
        linux({ state: "missing-bubblewrap", platform: "linux" }),
        t,
      ),
    ).toBe(
      'newSessionSandboxUnavailableMissingPackages {"packages":"bubblewrap"}',
    );
  });

  it.each([
    [
      { state: "probe-failed", blocker: { kind: "userns-restricted" } },
      "newSessionSandboxUnavailableUsernsRestricted",
    ],
    [{ state: "probe-failed" }, "newSessionSandboxUnavailableProbeFailed"],
    [{ state: "auth-required" }, "newSessionSandboxUnavailableAuthRequired"],
    [
      { state: "untrusted-bubblewrap" },
      "newSessionSandboxUnavailableUntrusted",
    ],
  ] as const)("explains %o", (availability, expected) => {
    expect(
      describeUnavailableSessionSandbox(
        linux({ platform: "linux", ...availability }),
        t,
      ),
    ).toBe(expected);
  });

  it("has nothing to explain when available, unsupported, or unreported", () => {
    expect(
      describeUnavailableSessionSandbox(
        linux({ state: "available", platform: "linux" }),
        t,
      ),
    ).toBeNull();
    expect(
      describeUnavailableSessionSandbox(
        linux({ state: "unsupported-platform", platform: "darwin" }),
        t,
      ),
    ).toBeNull();
    expect(
      describeUnavailableSessionSandbox(
        {
          capabilities: [],
          sessionSandboxing: { state: "probe-failed", platform: "linux" },
        },
        t,
      ),
    ).toBeNull();
  });
});
