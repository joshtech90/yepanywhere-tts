import { describe, expect, it } from "vitest";
import {
  buildCockpitHandoffMessage,
  COCKPIT_HANDOFF_PROMPT,
  extractCockpitHandoffSummary,
} from "./handoff";
import type { CockpitTranscriptEntry } from "./sessionDetail";

function user(key: string, text: string): CockpitTranscriptEntry {
  return { kind: "user", key, text };
}

function assistant(
  key: string,
  text: string,
  isStreaming = false,
): CockpitTranscriptEntry {
  return {
    kind: "assistant",
    key,
    text: [{ id: `${key}-t`, text, isStreaming, abortedMidStream: false }],
    thinking: [],
    spokenText: text,
    isStreaming,
  };
}

describe("extractCockpitHandoffSummary", () => {
  it("takes the finished answer to the latest handoff prompt", () => {
    const entries = [
      user("u1", COCKPIT_HANDOFF_PROMPT),
      assistant("a1", "Alte Übergabe"),
      user("u2", "Weiter"),
      assistant("a2", "Zwischenstand"),
      user("u3", COCKPIT_HANDOFF_PROMPT),
      assistant("a3", "1. Ziel\n2. Erledigt\n\nOrchestrierung: 100% Claude"),
    ];

    expect(extractCockpitHandoffSummary(entries)).toBe("1. Ziel\n2. Erledigt");
  });

  it("waits while the answer is missing or still streaming", () => {
    expect(
      extractCockpitHandoffSummary([user("u1", COCKPIT_HANDOFF_PROMPT)]),
    ).toBeNull();
    expect(
      extractCockpitHandoffSummary([
        user("u1", COCKPIT_HANDOFF_PROMPT),
        assistant("a1", "1. Ziel", true),
      ]),
    ).toBeNull();
    expect(extractCockpitHandoffSummary([assistant("a0", "Hallo")])).toBeNull();
  });
});

describe("buildCockpitHandoffMessage", () => {
  it("names the source and asks to continue", () => {
    const message = buildCockpitHandoffMessage({
      summary: "  1. Ziel  ",
      sourceTitle: "Gboard APK patchen",
    });
    expect(message).toContain("„Gboard APK patchen“");
    expect(message).toContain("\n\n1. Ziel\n\n");
    expect(message.endsWith("nächsten Schritt fort.")).toBe(true);
  });
});
