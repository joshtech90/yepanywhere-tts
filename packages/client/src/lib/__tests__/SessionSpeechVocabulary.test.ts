import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionSpeechVocabulary } from "../../hooks/useSessionSpeechVocabulary";
import { SessionSpeechVocabulary } from "../SessionSpeechVocabulary";

describe("active-session speech terms", () => {
  it("gates hint production and releases the growing set when the session changes", () => {
    const messages = [{ type: "assistant", content: "compiler" }];
    const { result, rerender } = renderHook(
      ({ enabled, sessionKey, loaded }) =>
        useSessionSpeechVocabulary(sessionKey, loaded, enabled),
      {
        initialProps: { enabled: false, sessionKey: "first", loaded: messages },
      },
    );
    expect(result.current).toBeUndefined();
    rerender({ enabled: true, sessionKey: "first", loaded: messages });
    expect(result.current?.terms()).toEqual(["compiler"]);
    rerender({ enabled: true, sessionKey: "first", loaded: [] });
    expect(result.current?.terms()).toEqual(["compiler"]);
    rerender({ enabled: true, sessionKey: "second", loaded: [] });
    expect(result.current?.terms()).toEqual([]);
  });

  it("grows without age-out and admits assistant reuse after an ASR introduction", () => {
    const vocabulary = new SessionSpeechVocabulary();
    const initial = [{ type: "user", content: "compiler" }];
    expect(vocabulary.terms(initial)).toEqual(["compiler"]);
    vocabulary.heard("compiler mistranscription");
    vocabulary.observe([
      {
        type: "user",
        content: "compiler mistranscription",
        messageMetadata: { speech: { clientTurnId: "mic-turn" } },
      },
      { type: "assistant", content: "mistranscription parser" },
      { type: "user", content: "sqlite" },
      {
        type: "assistant",
        content: [
          { type: "tool_use", input: "ignored" },
          { type: "thinking", text: "ignored" },
        ],
      },
    ]);
    // A trimmed/empty display window cannot erase the already observed session set.
    expect(vocabulary.terms([])).toEqual([
      "compiler",
      "mistranscription",
      "parser",
      "sqlite",
    ]);
    expect(new SessionSpeechVocabulary().terms([])).toEqual([]);
  });

  it("uses speech metadata with the prefix disabled when seeding a loaded session", () => {
    const vocabulary = new SessionSpeechVocabulary();
    expect(
      vocabulary.terms([
        {
          type: "user",
          content: "firstasr",
          messageMetadata: { speech: { clientTurnId: "turn" } },
        },
      ]),
    ).toEqual([]);
    vocabulary.observe([{ type: "assistant", content: "firstasr correction" }]);
    expect(vocabulary.terms([])).toEqual(["firstasr", "correction"]);
  });

  it("ignores provisional streaming text until it is finalized", () => {
    const vocabulary = new SessionSpeechVocabulary();
    expect(
      vocabulary.terms([
        { type: "assistant", content: "par", _isStreaming: true },
      ]),
    ).toEqual([]);
    vocabulary.observe([
      { type: "assistant", content: "parser", _isStreaming: false },
    ]);
    expect(vocabulary.terms([])).toEqual(["parser"]);
  });
});
