// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecureConnection } from "../SecureConnection";
import { ScriptedResumeSocket, resumeSession } from "./ScriptedResumeSocket";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(["relay", "direct"] as const)("%s resume evidence", (mode) => {
  function attempt(socket: ScriptedResumeSocket, established = vi.fn()) {
    if (mode === "relay")
      return SecureConnection.forResumeOnlyWithSocket(socket, resumeSession, {
        onSessionEstablished: established,
      });
    vi.stubGlobal("WebSocket", function WebSocketMock() {
      queueMicrotask(() => socket.onopen?.());
      return socket;
    });
    const connection = SecureConnection.forResumeOnly(resumeSession, {
      onSessionEstablished: established,
    });
    return connection.fetch("/auth/status").then(() => connection);
  }

  it.each(["silent", "silent-proof"] as const)(
    "preserves the credential after %s timeout, then resumes successfully",
    async (silence) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const socket = new ScriptedResumeSocket();
      socket.mode = silence;
      const original = { ...resumeSession };
      const established = vi.fn();
      const pending = attempt(socket, established);
      const assertion = expect(pending).rejects.toMatchObject({
        kind: "timeout",
      });
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      expect(established).not.toHaveBeenCalled();
      expect(resumeSession).toEqual(original);
      expect(socket.readyState).toBe(3);
      // A late verdict must not revive a failed handshake.
      socket.receive({ type: "srp_invalid", reason: "expired" });
      const recovered = await attempt(new ScriptedResumeSocket(), established);
      expect(established).toHaveBeenCalledOnce();
      recovered.close();
    },
  );

  it("preserves explicit rejection evidence", async () => {
    const socket = new ScriptedResumeSocket();
    socket.mode = "rejected";
    await expect(attempt(socket)).rejects.toMatchObject({
      kind: "rejected",
      message: expect.stringContaining("expired"),
    });
  });
});
