// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  beginHostCredentialAttempt,
  bindTabCredential,
  eraseTabCredential,
  clearTabCredentialOwner,
  isHostCredentialAttemptCurrent,
  commitHostCredential,
  clearHostSession,
  getHostById,
  getHostByRelayUsername,
  removeHost,
  upsertRelayHost,
} from "../hostStorage";
import {
  mutateResumeCredentials,
  retireRejectedResume,
  resumeGeneration,
  scopeForHost,
} from "../rejectedResumeStorage";
import { resumeSession } from "../connection/__tests__/ScriptedResumeSocket";
import type { ResumeObservation } from "../resumeDiagnostics";
import { advanceLegacyCredentialMirror } from "../legacyCredentialMirror";
import { REMOTE_CREDENTIALS_KEY } from "../storageKeys";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
const seed = (identity = "owner", endpoint = "wss://relay-one/ws") =>
  upsertRelayHost({
    relayUrl: endpoint,
    relayUsername: "server",
    srpUsername: identity,
    session: { ...resumeSession, username: identity },
  });

describe("saved credential ownership across tabs and authentication", () => {
  it("advances the legacy mirror through password replacement, resume and password fallback", async () => {
    const host = seed();
    const credential = beginHostCredentialAttempt(scopeForHost(host));
    const owner = { credential, mirrorSessionId: credential.previousSessionId };
    const envelope = {
      mode: "relay",
      wsUrl: host.relayUrl,
      relayUsername: host.relayUsername,
      username: host.srpUsername,
      session: host.session,
    };
    localStorage.setItem(REMOTE_CREDENTIALS_KEY, JSON.stringify(envelope));
    const fresh = { ...host.session!, sessionId: "fresh-login" };
    expect(commitHostCredential(credential, fresh, "password")).toBeDefined();
    advanceLegacyCredentialMirror(owner, fresh, "password");
    const resumed = { ...fresh, resumeProtocolVersion: 4 };
    expect(commitHostCredential(credential, resumed, "resume")).toBeDefined();
    advanceLegacyCredentialMirror(owner, resumed, "resume");
    expect(
      JSON.parse(localStorage.getItem(REMOTE_CREDENTIALS_KEY)!).session,
    ).toEqual(resumed);
    await retireRejectedResume(
      scopeForHost(host),
      resumed,
      [
        {
          attemptId: "mirror-resume",
          mode: "relay",
          endpoint: host.relayUrl!,
          identity: host.srpUsername,
          sessionId: resumed.sessionId,
          phase: "srp_resume_init_sent",
          event: "rejected",
          at: Date.now(),
          elapsedMs: 1,
          clientVersion: "test",
        },
      ],
      resumeGeneration(),
      () => isHostCredentialAttemptCurrent(credential),
    );
    const fallback = { ...fresh, sessionId: "password-fallback" };
    expect(
      commitHostCredential(credential, fallback, "password"),
    ).toBeDefined();
    advanceLegacyCredentialMirror(owner, fallback, "password");
    expect(
      JSON.parse(localStorage.getItem(REMOTE_CREDENTIALS_KEY)!).session,
    ).toEqual(fallback);
    localStorage.setItem(
      REMOTE_CREDENTIALS_KEY,
      JSON.stringify({
        ...envelope,
        session: { ...fresh, sessionId: "another-tab" },
      }),
    );
    advanceLegacyCredentialMirror(owner, fallback, "resume");
    expect(
      JSON.parse(localStorage.getItem(REMOTE_CREDENTIALS_KEY)!).session
        .sessionId,
    ).toBe("another-tab");
  });
  it("commits to the captured scope while another host becomes current", async () => {
    const first = seed();
    const attempt = await mutateResumeCredentials(() =>
      beginHostCredentialAttempt(scopeForHost(first), first.session),
    );
    const other = seed("other-owner", "wss://relay-two/ws");
    expect(
      commitHostCredential(attempt, {
        ...first.session!,
        resumeProtocolVersion: 4,
      })?.id,
    ).toBe(first.id);
    expect(getHostById(other.id)?.session).toEqual(other.session);
    expect(getHostByRelayUsername("server", "wss://relay-two/ws")?.id).toBe(
      other.id,
    );
  });

  it("a fresh login supersedes a delayed resume and an earlier password login", () => {
    const host = seed();
    const scope = scopeForHost(host);
    const oldResume = beginHostCredentialAttempt(scope, host.session);
    const oldLogin = beginHostCredentialAttempt(scope);
    const newLogin = beginHostCredentialAttempt(scope);
    const fresh = { ...host.session!, sessionId: "fresh-login" };
    expect(commitHostCredential(newLogin, fresh)).toBeDefined();
    expect(commitHostCredential(oldResume, host.session!)).toBeUndefined();
    expect(
      commitHostCredential(oldLogin, { ...fresh, sessionId: "late-login" }),
    ).toBeUndefined();
    expect(getHostById(host.id)?.session?.sessionId).toBe("fresh-login");
  });

  it.each(["erase", "remove"])(
    "%s cannot be undone by a delayed handshake",
    async (action) => {
      const host = seed();
      const attempt = beginHostCredentialAttempt(scopeForHost(host));
      if (action === "erase") clearHostSession(host.id);
      else await removeHost(host.id);
      expect(commitHostCredential(attempt, host.session!)).toBeUndefined();
      expect(getHostById(host.id)?.session).toBeUndefined();
    },
  );

  it("logout uses its tab's generation and leaves a newer login and other hosts alone", async () => {
    const host = seed();
    const peer = seed("peer", "wss://relay-two/ws");
    const old = beginHostCredentialAttempt(scopeForHost(host), host.session);
    bindTabCredential(old);
    const freshAttempt = beginHostCredentialAttempt(scopeForHost(host));
    const fresh = { ...host.session!, sessionId: "fresh-login" };
    commitHostCredential(freshAttempt, fresh);
    await eraseTabCredential();
    expect(getHostById(host.id)?.session).toEqual(fresh);
    bindTabCredential(freshAttempt);
    const pending = beginHostCredentialAttempt(scopeForHost(host), fresh);
    await eraseTabCredential();
    expect(getHostById(host.id)?.session).toBeUndefined();
    expect(commitHostCredential(pending, fresh)).toBeUndefined();
    expect(getHostById(peer.id)?.session).toEqual(peer.session);
  });

  it("logout of an unremembered connection cannot erase a previous host", async () => {
    const host = seed();
    bindTabCredential(
      beginHostCredentialAttempt(scopeForHost(host), host.session),
    );
    clearTabCredentialOwner();
    await eraseTabCredential();
    expect(getHostById(host.id)?.session).toEqual(host.session);
  });

  it("erasure of an empty record cancels a pending first password login", async () => {
    const host = upsertRelayHost({
      relayUrl: "wss://relay-one/ws",
      relayUsername: "server",
      srpUsername: "owner",
    });
    const pending = beginHostCredentialAttempt(scopeForHost(host));
    bindTabCredential(pending);
    await eraseTabCredential();
    expect(
      commitHostCredential(pending, { ...resumeSession, username: "owner" }),
    ).toBeUndefined();
  });

  it("an old refusal cannot cancel a newer password login still in flight", async () => {
    const host = seed();
    const scope = scopeForHost(host);
    const old = beginHostCredentialAttempt(scope, host.session);
    const pending = beginHostCredentialAttempt(scope);
    const observation: ResumeObservation = {
      attemptId: "old",
      mode: "relay",
      endpoint: scope.endpoint,
      identity: scope.identity,
      sessionId: host.session!.sessionId,
      phase: "srp_resume_init_sent",
      event: "rejected",
      at: Date.now(),
      elapsedMs: 1,
      clientVersion: "test",
    };
    await retireRejectedResume(
      scope,
      host.session!,
      [observation],
      resumeGeneration(),
      () => isHostCredentialAttemptCurrent(old),
    );
    expect(
      commitHostCredential(pending, { ...host.session!, sessionId: "new" }),
    ).toBeDefined();
  });

  it("different identities on a server retain independent credentials", () => {
    const host = seed();
    const attempt = beginHostCredentialAttempt(
      scopeForHost(host),
      host.session,
    );
    const otherIdentity = upsertRelayHost({
      relayUrl: host.relayUrl!,
      relayUsername: "server",
      srpUsername: "limited-user",
    });
    expect(otherIdentity.session).toBeUndefined();
    expect(otherIdentity.id).not.toBe(host.id);
    expect(commitHostCredential(attempt, host.session!)).toBeDefined();
    expect(getHostById(otherIdentity.id)?.session).toBeUndefined();
  });

  it("protocol pinning is monotonic within a session, while fresh login starts a new pin", () => {
    const host = seed();
    const scope = scopeForHost(host);
    const resume = beginHostCredentialAttempt(scope, host.session);
    expect(
      commitHostCredential(resume, {
        ...host.session!,
        resumeProtocolVersion: 4,
      }),
    ).toBeDefined();
    expect(commitHostCredential(resume, host.session!)).toBeUndefined();
    const login = beginHostCredentialAttempt(scope);
    expect(
      commitHostCredential(login, { ...host.session!, sessionId: "fresh-v3" }),
    ).toBeDefined();
  });

  it("an original password connection cannot revive a refused resume, but can save verified password fallback", async () => {
    const host = seed();
    const scope = scopeForHost(host);
    const owner = beginHostCredentialAttempt(scope);
    const first = { ...host.session!, sessionId: "password-login" };
    commitHostCredential(owner, first, "password");
    const observation: ResumeObservation = {
      attemptId: "later-resume",
      mode: "relay",
      endpoint: scope.endpoint,
      identity: scope.identity,
      sessionId: first.sessionId,
      phase: "srp_resume_init_sent",
      event: "rejected",
      at: Date.now(),
      elapsedMs: 1,
      clientVersion: "test",
    };
    await retireRejectedResume(
      scope,
      first,
      [observation],
      resumeGeneration(),
      () => isHostCredentialAttemptCurrent(owner),
    );
    expect(commitHostCredential(owner, first, "resume")).toBeUndefined();
    const replacement = { ...first, sessionId: "verified-password-fallback" };
    expect(commitHostCredential(owner, replacement, "password")).toBeDefined();
    expect(getHostById(host.id)?.session).toEqual(replacement);
    clearHostSession(host.id);
    expect(
      commitHostCredential(owner, replacement, "password"),
    ).toBeUndefined();
  });

  it("a delayed rejection cannot retire a fresh login or affect a peer", async () => {
    const host = seed();
    const peer = seed("peer", "wss://relay-two/ws");
    const scope = scopeForHost(host);
    const fresh = { ...host.session!, sessionId: "fresh-login" };
    commitHostCredential(beginHostCredentialAttempt(scope), fresh);
    const observation: ResumeObservation = {
      attemptId: "late",
      mode: "relay",
      endpoint: scope.endpoint,
      identity: scope.identity,
      relayUsername: scope.relayUsername,
      sessionId: host.session!.sessionId,
      phase: "srp_resume_init_sent",
      event: "rejected",
      at: Date.now(),
      elapsedMs: 1,
      clientVersion: "test",
    };
    await retireRejectedResume(
      scope,
      host.session!,
      [observation],
      resumeGeneration(),
      () => true,
    );
    expect(getHostById(host.id)?.session).toEqual(fresh);
    expect(getHostById(peer.id)?.session).toEqual(peer.session);
    const pending = beginHostCredentialAttempt(scope, fresh);
    await retireRejectedResume(
      scope,
      fresh,
      [{ ...observation, sessionId: fresh.sessionId }],
      resumeGeneration(),
      () => true,
    );
    expect(commitHostCredential(pending, fresh)).toBeUndefined();
  });
});
