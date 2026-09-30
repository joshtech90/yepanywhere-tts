import { describe, expect, it } from "vitest";
import { lineIsolatedInsertion } from "../PromptHistoryRail";

describe("lineIsolatedInsertion", () => {
  it("inserts bare text into an empty draft", () => {
    expect(lineIsolatedInsertion("", 0, "Hi")).toBe("Hi");
  });

  it("breaks the line on each side of mid-line text", () => {
    expect(lineIsolatedInsertion("abcd", 2, "Hi")).toBe("\nHi\n");
  });

  it("adds only the missing separator at a line boundary", () => {
    expect(lineIsolatedInsertion("ab\ncd", 3, "Hi")).toBe("Hi\n");
    expect(lineIsolatedInsertion("ab\ncd", 2, "Hi")).toBe("\nHi");
    expect(lineIsolatedInsertion("ab\n\ncd", 3, "Hi")).toBe("Hi");
  });

  it("separates from text at the draft's start or end", () => {
    expect(lineIsolatedInsertion("ab", 0, "Hi")).toBe("Hi\n");
    expect(lineIsolatedInsertion("ab", 2, "Hi")).toBe("\nHi");
  });
});
