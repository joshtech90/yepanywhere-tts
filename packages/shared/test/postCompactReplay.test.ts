import { describe, expect, it } from "vitest";
import {
  POST_COMPACT_REPLAY_PREAMBLE,
  isPostCompactReplayText,
} from "../src/postCompactReplay.js";

describe("historical post-compact replay recognition", () => {
  it("recognizes historical continuation turns without hiding ordinary input", () => {
    expect(
      isPostCompactReplayText(
        "  " + POST_COMPACT_REPLAY_PREAMBLE + "\ncontinue.",
      ),
    ).toBe(true);
    expect(isPostCompactReplayText("continue.")).toBe(false);
    expect(isPostCompactReplayText(null)).toBe(false);
  });
});
