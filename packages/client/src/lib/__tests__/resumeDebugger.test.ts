// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ScriptedResumeSocket,
  resumeSession,
} from "../connection/__tests__/ScriptedResumeSocket";
import { SecureConnection } from "../connection/SecureConnection";
import { openRelayClientSocket } from "../connection/RelayClientSocket";
import {
  forgetRetainedResumes,
  listRetainedResumes,
  REJECTED_RESUME_KEY,
} from "../rejectedResumeStorage";
import { initResumeDebugger } from "../resumeDebugger";
import { UI_KEYS } from "../storageKeys";

vi.mock("../connection/RelayClientSocket", () => ({
  openRelayClientSocket: vi.fn(),
}));
const scope = { relayUrl: "wss://test-relay/ws", relayUsername: "test-host" };
let cleanup: (() => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("navigator", {
    locks: { request: async (_: string, fn: () => unknown) => fn() },
  });
  const Encoder = TextEncoder;
  vi.stubGlobal(
    "TextEncoder",
    class extends Encoder {
      encode(text?: string) {
        return Uint8Array.from(super.encode(text));
      }
    },
  );
  localStorage.setItem(
    UI_KEYS.developerMode,
    JSON.stringify({ retainRejectedSrpSessions: true }),
  );
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});
async function retain(session = resumeSession) {
  const rejected = new ScriptedResumeSocket();
  rejected.mode = "rejected";
  await expect(
    SecureConnection.forResumeOnlyWithSocket(rejected, session, {}, scope),
  ).rejects.toMatchObject({ kind: "rejected" });
  expect(rejected.readyState).toBe(3);
  cleanup = initResumeDebugger();
  return listRetainedResumes()[0]?.id ?? "missing";
}
it("retains at the actual refusal boundary, probes through verifier with fresh nonce, closes without active storage or navigation changes", async () => {
  // Relay password logins intentionally store no direct WebSocket URL.
  const id = await retain({ ...resumeSession, wsUrl: "" });
  const healthy = new ScriptedResumeSocket();
  const connection = await SecureConnection.forResumeOnlyWithSocket(
    healthy,
    resumeSession,
    {},
    scope,
  );
  const probe = new ScriptedResumeSocket();
  vi.mocked(openRelayClientSocket).mockResolvedValue(
    probe as unknown as WebSocket,
  );
  const before = {
    url: window.location.href,
    active: localStorage.getItem("yep-anywhere-remote-credentials"),
  };
  expect(await window.__YA_RESUME_DEBUG__?.probe(id)).toEqual({
    outcome: "authenticated",
  });
  expect(probe.readyState).toBe(3);
  expect(healthy.readyState).toBe(1);
  expect({
    url: window.location.href,
    active: localStorage.getItem("yep-anywhere-remote-credentials"),
  }).toEqual(before);
  const nonce = (socket: ScriptedResumeSocket) =>
    (
      socket.sent.find(
        (m) => (m as { type?: string }).type === "srp_resume_init",
      ) as {
        clientNonce: string;
      }
    ).clientNonce;
  expect(nonce(probe)).not.toBe(nonce(healthy));
  expect(JSON.stringify(window.__YA_RESUME_DEBUG__?.list())).not.toContain(
    resumeSession.sessionKey,
  );
  cleanup?.();
  cleanup = initResumeDebugger();
  expect(window.__YA_RESUME_DEBUG__?.list()).toHaveLength(1);
  connection.close();
});
it("never relaxes protocol verification during a probe", async () => {
  const id = await retain();
  const probe = new ScriptedResumeSocket();
  probe.mode = "bad-proof";
  vi.mocked(openRelayClientSocket).mockResolvedValue(
    probe as unknown as WebSocket,
  );
  expect(await window.__YA_RESUME_DEBUG__?.probe(id)).toEqual({
    outcome: "verification",
  });
  expect(probe.readyState).toBe(3);
  expect(listRetainedResumes()).toHaveLength(1);
});
it("bounds concurrent probes and erases/cancels without late resurrection", async () => {
  const id = await retain();
  const probe = new ScriptedResumeSocket();
  probe.mode = "silent";
  vi.mocked(openRelayClientSocket).mockResolvedValue(
    probe as unknown as WebSocket,
  );
  const pending = window.__YA_RESUME_DEBUG__?.probe(id);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(await window.__YA_RESUME_DEBUG__?.probe(id)).toEqual({
    outcome: "busy",
  });
  forgetRetainedResumes();
  expect(await pending).toEqual({ outcome: "cancelled" });
  expect(probe.readyState).toBe(3);
  expect(localStorage.getItem(REJECTED_RESUME_KEY)).toBeNull();
});
it("archives proven incompatibility before any resume frame, and removes helper on disable", async () => {
  const old = { ...resumeSession, resumeProtocolVersion: 1 };
  const socket = new ScriptedResumeSocket();
  await expect(
    SecureConnection.forResumeOnlyWithSocket(socket, old, {}, scope),
  ).rejects.toMatchObject({ kind: "incompatible" });
  expect(socket.sent).toHaveLength(0);
  cleanup = initResumeDebugger();
  expect(window.__YA_RESUME_DEBUG__?.list()).toHaveLength(1);
  localStorage.setItem(UI_KEYS.developerMode, "{}");
  window.dispatchEvent(
    new StorageEvent("storage", { key: UI_KEYS.developerMode }),
  );
  expect(window.__YA_RESUME_DEBUG__).toBeUndefined();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(localStorage.getItem(REJECTED_RESUME_KEY)).toBeNull();
});

it("preserves the rejected candidate before password fallback replaces it", async () => {
  const socket = new ScriptedResumeSocket();
  socket.mode = "rejected";
  vi.stubGlobal("WebSocket", function WebSocketMock() {
    queueMicrotask(() => socket.onopen?.());
    return socket;
  });
  const connection = SecureConnection.fromStoredSession(
    resumeSession,
    "password-fixture",
  );
  const fallback = vi
    .spyOn(
      connection as unknown as {
        startFullSrpHandshake: (
          reject: (error: Error) => void,
        ) => Promise<void>;
      },
      "startFullSrpHandshake",
    )
    .mockImplementation(async (reject) => {
      expect(listRetainedResumes()).toHaveLength(1);
      reject(new Error("stop-full-SRP-fixture"));
    });
  await expect(connection.fetch("/auth/status")).rejects.toThrow(
    "stop-full-SRP-fixture",
  );
  expect(fallback).toHaveBeenCalledOnce();
  expect(listRetainedResumes()[0]?.sessionId).toBe(resumeSession.sessionId);
  connection.close();
});
