import type { ActingPrincipal } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  knownLockedEffort,
  knownLockedProvider,
  launchLockFor,
  launchLockOverrides,
  UNLOCKED_LAUNCH,
} from "../limitedLaunchLock";

/** Contract: topics/limited-users.md § Delivery v1 — Settings → Users. */

const superuser: ActingPrincipal = {
  superuser: true,
  username: null,
  switched: false,
  locked: false,
  enabled: true,
  hasLimitedUsers: false,
  logoutRedirect: "stay",
};

function limited(lock: Record<string, string>): ActingPrincipal {
  return {
    superuser: false,
    username: "alice",
    switched: false,
    locked: true,
    enabled: true,
    hasLimitedUsers: true,
    logoutRedirect: "direct-login",
    grants: {
      newSessionProjects: ["p1"],
      joinProjects: [],
      viewProjects: [],
      joinStaleOffsetMinutes: 0,
      lock,
    },
  };
}

describe("launchLockFor", () => {
  it("leaves the superuser free, including a switched-back one", () => {
    expect(launchLockFor(superuser)).toEqual(UNLOCKED_LAUNCH);
    expect(launchLockOverrides(launchLockFor(superuser))).toEqual({});
  });

  it("fixes the sandbox for a limited user with no field lock at all", () => {
    const lock = launchLockFor(limited({}));
    expect(lock).toEqual({
      limited: true,
      provider: null,
      model: null,
      effort: null,
    });
    expect(launchLockOverrides(lock)).toEqual({
      sandboxLevel: "project-write",
    });
  });

  it("carries a provider, model, and effort lock into the launch body", () => {
    const lock = launchLockFor(
      limited({ provider: "codex", model: "gpt-5", effort: "medium" }),
    );
    expect(lock).toEqual({
      limited: true,
      provider: "codex",
      model: "gpt-5",
      effort: "medium",
    });
    expect(launchLockOverrides(lock)).toEqual({
      provider: "codex",
      model: "gpt-5",
      // The body names a thinking option, not a bare effort.
      thinking: "on:medium",
      sandboxLevel: "project-write",
    });
  });

  it("keeps a provider or effort this client cannot name locked", () => {
    const lock = launchLockFor(
      limited({ provider: "newer-provider", effort: "colossal" }),
    );
    // Still locked, so the form withholds the pickers and states the values.
    expect(lock.provider).toBe("newer-provider");
    expect(lock.effort).toBe("colossal");
    expect(knownLockedProvider(lock)).toBeNull();
    expect(knownLockedEffort(lock)).toBeNull();
    // The route refuses any other value, so the launch sends these verbatim.
    expect(launchLockOverrides(lock)).toEqual({
      provider: "newer-provider",
      thinking: "on:colossal",
      sandboxLevel: "project-write",
    });
  });

  it("names a known locked provider and effort for seeding the pickers", () => {
    const lock = launchLockFor(limited({ provider: "codex", effort: "high" }));
    expect(knownLockedProvider(lock)).toBe("codex");
    expect(knownLockedEffort(lock)).toBe("high");
  });
});
