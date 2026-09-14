// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createClientSummaryHostSourceKey } from "../clientSummaryStore";
import {
  clearNewSessionPrefill,
  consumeNewSessionPrefill,
  consumeNewSessionPrefillToken,
  createNewSessionPrefillKey,
  getNewSessionPrefill,
  setNewSessionPrefill,
  stashNewSessionPrefillToken,
} from "../newSessionPrefill";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("newSessionPrefill", () => {
  it("keeps prefills isolated by source", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    setNewSessionPrefill(macbook, "mac prompt");

    expect(getNewSessionPrefill(winnative)).toBeNull();

    setNewSessionPrefill(winnative, "win prompt");

    expect(getNewSessionPrefill(macbook)).toBe("mac prompt");
    expect(getNewSessionPrefill(winnative)).toBe("win prompt");

    clearNewSessionPrefill(winnative);

    expect(getNewSessionPrefill(macbook)).toBe("mac prompt");
    expect(getNewSessionPrefill(winnative)).toBeNull();
  });

  it("builds encoded source keys", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");

    expect(createNewSessionPrefillKey(macbook)).toBe(
      "new-session-prefill:host%3Amacbook",
    );
  });

  it("consumes a start-caret prefill and a one-shot new-tab token", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    setNewSessionPrefill(macbook, "handoff text", { caret: "start" });

    expect(consumeNewSessionPrefill(macbook)).toEqual({
      caret: "start",
      text: "handoff text",
    });
    expect(getNewSessionPrefill(macbook)).toBeNull();

    const token = stashNewSessionPrefillToken(macbook, "tab text", {
      caret: "start",
    });
    expect(consumeNewSessionPrefillToken("missing", macbook)).toBeNull();
    expect(consumeNewSessionPrefillToken(token, macbook)).toEqual({
      caret: "start",
      text: "tab text",
    });
    expect(consumeNewSessionPrefillToken(token, macbook)).toBeNull();
  });
});
