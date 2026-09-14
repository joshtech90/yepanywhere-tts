import { describe, expect, it } from "vitest";
import { getSessionConnectionBarStatus } from "../sessionConnectionBar";

describe("getSessionConnectionBarStatus", () => {
  const base = {
    hasSessionUpdateStream: true,
    sessionUpdatesConnected: false,
    sessionUpdatesResubscribing: false,
    showConnectionBars: false,
    transportReconnecting: false,
  };

  it("stays idle when the session has no live update stream", () => {
    expect(
      getSessionConnectionBarStatus({
        ...base,
        hasSessionUpdateStream: false,
        showConnectionBars: true,
      }),
    ).toBe("idle");
  });

  it("always shows disconnected when the stream is down and not coming back", () => {
    expect(getSessionConnectionBarStatus(base)).toBe("disconnected");
    expect(
      getSessionConnectionBarStatus({ ...base, showConnectionBars: true }),
    ).toBe("disconnected");
  });

  it("keeps a resubscribe out of the red bar", () => {
    expect(
      getSessionConnectionBarStatus({
        ...base,
        sessionUpdatesResubscribing: true,
      }),
    ).toBe("idle");
    expect(
      getSessionConnectionBarStatus({
        ...base,
        sessionUpdatesResubscribing: true,
        showConnectionBars: true,
      }),
    ).toBe("connecting");
  });

  it("keeps a reconnecting transport out of the red bar", () => {
    expect(
      getSessionConnectionBarStatus({ ...base, transportReconnecting: true }),
    ).toBe("idle");
    expect(
      getSessionConnectionBarStatus({
        ...base,
        transportReconnecting: true,
        showConnectionBars: true,
      }),
    ).toBe("connecting");
  });

  it("treats a live session stream as connected only when bars are on", () => {
    expect(
      getSessionConnectionBarStatus({
        ...base,
        sessionUpdatesConnected: true,
      }),
    ).toBe("idle");
    expect(
      getSessionConnectionBarStatus({
        ...base,
        sessionUpdatesConnected: true,
        showConnectionBars: true,
      }),
    ).toBe("connected");
  });
});
