import { describe, expect, it } from "vitest";
import {
  parseInstallationBody,
  parseNotificationBody,
  parsePushTarget,
} from "../src/validation.js";

describe("push broker request validation", () => {
  it("accepts the two credential-free FCM target forms", () => {
    expect(
      parsePushTarget({
        provider: "fcm",
        kind: "fid",
        value: "firebase-installation-id",
      }),
    ).toBeDefined();
    expect(
      parsePushTarget({
        provider: "fcm",
        kind: "registration_token",
        value: "legacy-registration-token",
      }),
    ).toBeDefined();
  });

  it("rejects unknown target fields and control characters", () => {
    expect(
      parsePushTarget({
        provider: "fcm",
        kind: "fid",
        value: "target",
        arbitrary: true,
      }),
    ).toBeUndefined();
    expect(
      parsePushTarget({
        provider: "fcm",
        kind: "fid",
        value: "bad\nvalue",
      }),
    ).toBeUndefined();
  });

  it("accepts only exact generic notification intents", () => {
    expect(parseNotificationBody({ intent: "approval_required" })).toEqual({
      intent: "approval_required",
    });
    expect(
      parseNotificationBody({
        intent: "approval_required",
        title: "private title",
      }),
    ).toBeUndefined();
    expect(
      parseNotificationBody({ intent: "arbitrary_event" }),
    ).toBeUndefined();
  });

  it("requires an exact installation envelope", () => {
    expect(
      parseInstallationBody({
        target: {
          provider: "fcm",
          kind: "fid",
          value: "target",
        },
      }),
    ).toBeDefined();
    expect(parseInstallationBody({})).toBeUndefined();
  });
  it("bounds optional opaque navigation and test hints without accepting URLs or content", () => {
    expect(
      parseNotificationBody({
        intent: "input_required",
        sessionId: "session-1",
        eventId: "event_1",
        test: true,
      }),
    ).toBeDefined();
    for (const extra of [
      { sessionId: "https://attacker.test" },
      { sessionId: "x".repeat(129) },
      { test: false },
      { eventId: "../path" },
      { url: "/sessions/1" },
      { title: "private" },
    ])
      expect(
        parseNotificationBody({ intent: "input_required", ...extra }),
      ).toBeUndefined();
  });
});
