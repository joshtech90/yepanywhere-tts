import { describe, expect, it } from "vitest";
import { deriveCockpitShellState } from "./shellState";

function snapshot(
  state: "ready" | "connecting" | "reconnecting" | "disconnected",
  lastError?: string,
) {
  return {
    kind: "secure",
    state,
    channels: [
      {
        name: "secure-websocket",
        state: state === "ready" ? "connected" : state,
        lastError,
      },
    ],
  };
}

describe("Cockpit shell state", () => {
  it("shows the empty workspace only when the source is ready", () => {
    expect(deriveCockpitShellState(snapshot("ready"))).toEqual({
      kind: "empty",
    });
  });

  it.each(["connecting", "reconnecting"] as const)(
    "keeps geometry reserved while %s",
    (state) => {
      expect(deriveCockpitShellState(snapshot(state))).toEqual({
        kind: "loading",
      });
    },
  );

  it("distinguishes an ordinary offline source from a reported error", () => {
    expect(deriveCockpitShellState(snapshot("disconnected"))).toEqual({
      kind: "offline",
    });
    expect(
      deriveCockpitShellState(snapshot("disconnected", "relay failed")),
    ).toEqual({ kind: "error" });
  });
});
