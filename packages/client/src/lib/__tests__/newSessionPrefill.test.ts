// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createClientSummaryHostSourceKey } from "../clientSummaryStore";
import {
  clearNewSessionPrefill,
  consumeNewSessionPrefill,
  consumeNewSessionPrefillToken,
  createNewSessionPrefillKey,
  createNewSessionPrefillToken,
  getNewSessionPrefill,
  setNewSessionPrefill,
  stashNewSessionPrefillToken,
} from "../newSessionPrefill";

const TOKEN_KEY_PREFIX = "new-session-prefill-token:";

function tokenKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(TOKEN_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

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

    const token = createNewSessionPrefillToken();
    stashNewSessionPrefillToken(token, macbook, "tab text", {
      caret: "start",
    });
    expect(consumeNewSessionPrefillToken("missing", macbook)).toBeNull();
    expect(consumeNewSessionPrefillToken(token, macbook)).toEqual({
      caret: "start",
      text: "tab text",
    });
    expect(consumeNewSessionPrefillToken(token, macbook)).toBeNull();
  });

  it("forgets a stashed token no tab ever claimed", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const abandoned = createNewSessionPrefillToken();
    localStorage.setItem(
      `${TOKEN_KEY_PREFIX}${abandoned}`,
      JSON.stringify({
        caret: "end",
        sourceKey: macbook,
        text: "tab that never opened",
        writtenAt: Date.now() - 2 * 60 * 60 * 1000,
      }),
    );

    const fresh = createNewSessionPrefillToken();
    stashNewSessionPrefillToken(fresh, macbook, "this tab");

    expect(tokenKeys()).toEqual([`${TOKEN_KEY_PREFIX}${fresh}`]);
    expect(consumeNewSessionPrefillToken(fresh, macbook)).toEqual({
      caret: "end",
      text: "this tab",
    });
    expect(tokenKeys()).toEqual([]);
  });

  it("consumes a token stashed before tokens carried a write time", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const token = createNewSessionPrefillToken();
    localStorage.setItem(
      `${TOKEN_KEY_PREFIX}${token}`,
      JSON.stringify({ caret: "start", sourceKey: macbook, text: "in flight" }),
    );

    expect(consumeNewSessionPrefillToken(token, macbook)).toEqual({
      caret: "start",
      text: "in flight",
    });
  });
});
