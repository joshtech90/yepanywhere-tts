import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import { draftTextIsAccountedFor } from "../draftSendReconcile";

const SENT_AT_MS = Date.parse("2026-09-27T12:00:00.000Z");
const AFTER_SEND = "2026-09-27T12:00:01.000Z";
const EARLIER = "2026-09-27T11:58:00.000Z";

function durableUserTurn(text: string, timestamp = AFTER_SEND): Message {
  return {
    uuid: `durable-${text}-${timestamp}`,
    type: "user",
    _source: "jsonl",
    timestamp,
    message: { role: "user", content: text },
  };
}

function optimisticSelfEcho(text: string): Message {
  return {
    uuid: `echo-${text}`,
    type: "user",
    _source: "sdk",
    timestamp: AFTER_SEND,
    tempId: `temp-${text}`,
    message: { role: "user", content: text },
  };
}

describe("draftTextIsAccountedFor", () => {
  it("matches a durable user turn in the transcript tail", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "run the tests",
        messages: [
          durableUserTurn("earlier"),
          durableUserTurn("run the tests"),
        ],
      }),
    ).toBe(true);
  });

  it("ignores leading and trailing whitespace differences", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "  run the tests\n",
        messages: [durableUserTurn("run the tests")],
      }),
    ).toBe(true);
  });

  it("matches a durable turn carrying server-injected turn markers", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "run the tests",
        messages: [durableUserTurn("(12s ago) run the tests")],
      }),
    ).toBe(true);
  });

  it("matches a message the server holds queued", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "run the tests",
        messages: [],
        deferredMessages: [{ content: "run the tests", timestamp: AFTER_SEND }],
      }),
    ).toBe(true);
  });

  it("does not accept an optimistic self-send echo as proof", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "run the tests",
        messages: [optimisticSelfEcho("run the tests")],
      }),
    ).toBe(false);
  });

  it("does not match a turn the user only partly reused", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "run the tests again",
        messages: [durableUserTurn("run the tests")],
      }),
    ).toBe(false);
  });

  it("does not match assistant text", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "run the tests",
        messages: [
          {
            uuid: "assistant-1",
            type: "assistant",
            timestamp: AFTER_SEND,
            _source: "jsonl",
            message: { role: "assistant", content: "run the tests" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("treats an empty draft as unaccounted for", () => {
    expect(
      draftTextIsAccountedFor({
        sentAtMs: SENT_AT_MS,
        draftText: "   ",
        messages: [durableUserTurn("   ")],
      }),
    ).toBe(false);
  });

  it("finds the sent prompt behind a long tool-heavy reply", () => {
    const messages: Message[] = [
      durableUserTurn("run the tests"),
      ...Array.from(
        { length: 80 },
        (_, index): Message => ({
          uuid: `result-${index}`,
          type: "user",
          _source: "jsonl",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: `tool-${index}`,
                content: "ok",
              },
            ],
          },
        }),
      ),
    ];
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        sentAtMs: SENT_AT_MS,
        messages,
      }),
    ).toBe(true);
  });

  it("does not take an earlier identical prompt as proof of this send", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "continue",
        sentAtMs: SENT_AT_MS,
        messages: [durableUserTurn("continue", EARLIER), durableUserTurn("ok")],
      }),
    ).toBe(false);
  });

  it("does not take an earlier identical queued message as proof of this send", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "continue",
        sentAtMs: SENT_AT_MS,
        messages: [],
        deferredMessages: [{ content: "continue", timestamp: EARLIER }],
      }),
    ).toBe(false);
  });

  it("finds this send behind an earlier identical prompt", () => {
    expect(
      draftTextIsAccountedFor({
        draftText: "continue",
        sentAtMs: SENT_AT_MS,
        messages: [
          durableUserTurn("continue", EARLIER),
          durableUserTurn("continue"),
        ],
      }),
    ).toBe(true);
  });

  it("does not accept a matching turn with no timestamp", () => {
    const undated = durableUserTurn("run the tests");
    delete undated.timestamp;
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        sentAtMs: SENT_AT_MS,
        messages: [undated],
      }),
    ).toBe(false);
  });

  it("only scans a bounded number of user prompts", () => {
    const messages = [
      durableUserTurn("run the tests"),
      ...Array.from({ length: 80 }, (_, index) =>
        durableUserTurn(`filler ${index}`),
      ),
    ];
    expect(
      draftTextIsAccountedFor({
        draftText: "run the tests",
        sentAtMs: SENT_AT_MS,
        messages,
      }),
    ).toBe(false);
  });
});
