// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureBrowserSettings } from "../browserSettingsBackup";
import { resumeSession } from "../connection/__tests__/ScriptedResumeSocket";
import { removeHost } from "../hostStorage";
import {
  acquireRetainedResume,
  forgetRetainedResumes,
  initResumeRetention,
  listRetainedResumes,
  mutateResumeCredentials,
  REJECTED_RESUME_KEY,
  RESUME_RETENTION_MS,
  resumeGeneration,
  retireRejectedResume,
  type ResumeScope,
} from "../rejectedResumeStorage";
import {
  subscribeResumeObservations,
  type ResumeObservation,
} from "../resumeDiagnostics";
import { SAVED_HOSTS_KEY, UI_KEYS } from "../storageKeys";

const scope: ResumeScope = {
  mode: "relay",
  endpoint: "wss://test-relay/ws",
  identity: resumeSession.username,
  relayUsername: "test-host",
};
const activeKey = "yep-anywhere-remote-credentials";
function enabled(value = true) {
  localStorage.setItem(
    UI_KEYS.developerMode,
    JSON.stringify({ retainRejectedSrpSessions: value }),
  );
}
function observation(
  event: ResumeObservation["event"] = "rejected",
): ResumeObservation {
  return {
    attemptId: "test-attempt",
    sessionId: resumeSession.sessionId,
    phase: "srp_resume_init_sent",
    event,
    at: Date.now(),
    elapsedMs: 1,
    clientVersion: "test",
    protocolVersion: 3,
  };
}
function seed() {
  localStorage.setItem(
    activeKey,
    JSON.stringify({
      wsUrl: scope.endpoint,
      username: scope.identity,
      mode: "relay",
      relayUsername: scope.relayUsername,
      session: resumeSession,
    }),
  );
  localStorage.setItem(
    SAVED_HOSTS_KEY,
    JSON.stringify({
      version: 1,
      hosts: [
        {
          id: "host",
          mode: "relay",
          relayUrl: scope.endpoint,
          srpUsername: scope.identity,
          relayUsername: scope.relayUsername,
          session: resumeSession,
        },
      ],
    }),
  );
}
async function reject(generation = resumeGeneration(), current = () => true) {
  await retireRejectedResume(
    scope,
    resumeSession,
    [observation()],
    generation,
    current,
  );
}
beforeEach(() => {
  localStorage.clear();
  enabled();
  seed();
  vi.stubGlobal("navigator", {
    locks: { request: vi.fn(async (_: string, fn: () => unknown) => fn()) },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("rejected SRP credential ownership", () => {
  it("keeps normal credential writes working when Web Locks is denied", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: async () => {
          throw new DOMException("denied", "SecurityError");
        },
      },
    });
    const write = vi.fn(() => "written");
    expect(await mutateResumeCredentials(write)).toBe("written");
    expect(write).toHaveBeenCalledOnce();
    await reject();
    expect(listRetainedResumes()).toHaveLength(0);
    expect(
      JSON.parse(localStorage.getItem(activeKey) ?? "{}").session,
    ).toBeUndefined();
  });

  it("archives duplicate active copies once, preserves pin, excludes keys from reports and portable backups", async () => {
    const logs: ResumeObservation[] = [];
    const stop = subscribeResumeObservations((e) => logs.push(e));
    await reject();
    await reject();
    stop();
    const list = listRetainedResumes();
    expect(list).toHaveLength(1);
    expect(list[0]?.protocolVersion).toBe(3);
    expect(
      (await acquireRetainedResume(list[0]?.id ?? ""))?.session.sessionKey,
    ).toBe(resumeSession.sessionKey);
    expect(
      JSON.parse(localStorage.getItem(activeKey) ?? "{}").session,
    ).toBeUndefined();
    expect(
      JSON.parse(localStorage.getItem(SAVED_HOSTS_KEY) ?? "{}").hosts[0]
        .session,
    ).toBeUndefined();
    for (const report of [list, logs, captureBrowserSettings()])
      expect(JSON.stringify(report)).not.toContain(resumeSession.sessionKey);
  });
  it("retains no key by default or without cross-tab coordination", async () => {
    enabled(false);
    await reject();
    expect(localStorage.getItem(REJECTED_RESUME_KEY)).toBeNull();
    enabled();
    seed();
    vi.stubGlobal("navigator", {});
    await reject();
    expect(localStorage.getItem(REJECTED_RESUME_KEY)).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(activeKey) ?? "{}").session,
    ).toBeUndefined();
  });
  it.each(["timeout", "verification", "protocol", "server"] as const)(
    "does not retire %s failures",
    async (event) => {
      await retireRejectedResume(
        scope,
        resumeSession,
        [observation(event)],
        resumeGeneration(),
        () => true,
      );
      expect(
        JSON.parse(localStorage.getItem(activeKey) ?? "{}").session,
      ).toEqual(resumeSession);
      expect(listRetainedResumes()).toHaveLength(0);
    },
  );
  it("never deletes a newer session or another endpoint/principal, and ignores superseded attempts", async () => {
    const credentials = JSON.parse(localStorage.getItem(activeKey) ?? "{}");
    credentials.session = { ...resumeSession, sessionId: "new-login" };
    localStorage.setItem(activeKey, JSON.stringify(credentials));
    await reject();
    expect(
      JSON.parse(localStorage.getItem(activeKey) ?? "{}").session.sessionId,
    ).toBe("new-login");
    seed();
    await retireRejectedResume(
      { ...scope, endpoint: "wss://other/ws" },
      resumeSession,
      [observation()],
      resumeGeneration(),
      () => true,
    );
    expect(JSON.parse(localStorage.getItem(activeKey) ?? "{}").session).toEqual(
      resumeSession,
    );
    await retireRejectedResume(
      { ...scope, identity: "another-person" },
      { ...resumeSession, username: "another-person" },
      [observation()],
      resumeGeneration(),
      () => true,
    );
    expect(
      JSON.parse(localStorage.getItem(SAVED_HOSTS_KEY) ?? "{}").hosts[0]
        .session,
    ).toEqual(resumeSession);
    forgetRetainedResumes();
    await reject(resumeGeneration(), () => false);
    expect(listRetainedResumes()).toHaveLength(0);
  });
  it("bounds records and observations, preserves first expiry, prunes after a reload/read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T08:00:00Z"));
    await reject();
    const first = listRetainedResumes()[0];
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 12; i++) await reject();
    expect(listRetainedResumes()[0]?.expiresAt).toBe(first?.expiresAt);
    expect(listRetainedResumes()[0]?.observations).toHaveLength(8);
    for (let i = 0; i < 9; i++)
      await retireRejectedResume(
        { ...scope, endpoint: `wss://host-${i}/ws` },
        { ...resumeSession, sessionId: `session-${i}` },
        [observation()],
        resumeGeneration(),
        () => true,
      );
    expect(listRetainedResumes()).toHaveLength(8);
    vi.advanceTimersByTime(RESUME_RETENTION_MS);
    expect(listRetainedResumes()).toHaveLength(0);
    await acquireRetainedResume("missing");
    expect(localStorage.getItem(REJECTED_RESUME_KEY)).toBeNull();
  });
  it("prunes expired keys at startup even without Web Locks", async () => {
    vi.useFakeTimers();
    await reject();
    vi.advanceTimersByTime(RESUME_RETENTION_MS);
    vi.stubGlobal("navigator", {});
    const stop = initResumeRetention();
    expect(localStorage.getItem(REJECTED_RESUME_KEY)).toBeNull();
    stop();
  });

  it("rejects malformed archive data and reports quota failure without claiming preservation", async () => {
    localStorage.setItem(REJECTED_RESUME_KEY, "broken-json");
    expect(listRetainedResumes()).toEqual([]);
    const set = localStorage.setItem;
    vi.spyOn(localStorage, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === REJECTED_RESUME_KEY)
        throw new DOMException("quota", "QuotaExceededError");
      set.call(this, key, value);
    });
    const events: ResumeObservation[] = [];
    const stop = subscribeResumeObservations((e) => events.push(e));
    await reject();
    stop();
    expect(events.map((e) => e.event)).toEqual(["storage_failure"]);
    expect(
      JSON.parse(localStorage.getItem(activeKey) ?? "{}").session,
    ).toBeUndefined();
  });
  it("erasure tombstone prevents queued rejection from resurrecting keys", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_: string, fn: () => unknown) => {
          await gate;
          return fn();
        },
      },
    });
    const pending = reject();
    forgetRetainedResumes();
    release?.();
    await pending;
    expect(listRetainedResumes()).toHaveLength(0);
  });
  it("host removal purges its archive and invalidates in-flight attempts", async () => {
    await reject();
    const generation = resumeGeneration();
    await removeHost("host");
    await reject(generation);
    expect(listRetainedResumes()).toHaveLength(0);
  });
});
