import { describe, expect, it } from "vitest";
import { collectQuoteReplies, quoteReplyKey } from "./quoteReplies.js";

describe("sent quote replies", () => {
  it("keeps each complete quote and its own addition", () => {
    expect([
      ...collectQuoteReplies(
        "Some context\n\n> First line\r\n> second line?\r\n\r\nYes.\n\n> Another question?\n\nNo.",
      ),
    ]).toEqual([
      [quoteReplyKey("First line\nsecond line?"), "Yes."],
      ["Another question?", "No."],
    ]);
  });

  it("ignores bare quotes and quoted examples inside code fences", () => {
    expect([
      ...collectQuoteReplies(
        "```markdown\n> Example?\n\nExample answer\n```\n\n> Unanswered?\n\n",
      ),
    ]).toEqual([]);
    expect([
      ...collectQuoteReplies(
        "> Actual question?\n\n```text\n> literal reply\n```",
      ),
    ]).toEqual([["Actual question?", "```text\n> literal reply\n```"]]);
  });
});
