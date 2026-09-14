import { describe, expect, it } from "vitest";
import {
  grokInterjectAccepted,
  splitGrokUserMessageTexts,
  unwrapGrokInterjectText,
} from "../../../src/sdk/providers/grok-interject-text.js";

const WRAP_PREFIX =
  "The user sent a message while you were working:\n<user_query>\n";
const WRAP_SUFFIX =
  "\n</user_query>\nMake sure to complete any unfinished tasks from previous turns.";

function wrap(inner: string): string {
  return `${WRAP_PREFIX}${inner}${WRAP_SUFFIX}`;
}

describe("unwrapGrokInterjectText", () => {
  it("returns ordinary user text unchanged", () => {
    expect(unwrapGrokInterjectText("just a normal steer")).toBe(
      "just a normal steer",
    );
  });

  it("strips the outer Grok interject envelope", () => {
    expect(unwrapGrokInterjectText(wrap("stop and fix the test"))).toBe(
      "stop and fix the test",
    );
  });

  it("keeps quoted inner user_query markup from the user's text", () => {
    const inner = [
      "show only what is inside the user_query tags ",
      "'The user sent a message while you were working:",
      "<user_query>",
      "quoted example",
      "</user_query>",
      "Make sure to complete any unfinished tasks from previous turns.'",
    ].join("\n");
    expect(unwrapGrokInterjectText(wrap(inner))).toBe(inner);
  });

  it("leaves a partial envelope alone", () => {
    const partial = `${WRAP_PREFIX}still typing`;
    expect(unwrapGrokInterjectText(partial)).toBe(partial);
  });
});

describe("splitGrokUserMessageTexts", () => {
  it("returns ordinary user text as one part", () => {
    expect(splitGrokUserMessageTexts("just a normal steer")).toEqual([
      "just a normal steer",
    ]);
  });

  it("unwraps a single envelope", () => {
    expect(splitGrokUserMessageTexts(wrap("stop and fix the test"))).toEqual([
      "stop and fix the test",
    ]);
  });

  it("keeps quoted inner user_query markup in one part", () => {
    const inner = [
      "show only what is inside the user_query tags ",
      "'The user sent a message while you were working:",
      "<user_query>",
      "quoted example",
      "</user_query>",
      "Make sure to complete any unfinished tasks from previous turns.'",
    ].join("\n");
    expect(splitGrokUserMessageTexts(wrap(inner))).toEqual([inner]);
  });

  it("does not split on a bare </user_query> mention inside one envelope", () => {
    const inner =
      "doubles resolve on reload except the </user_query> noise joined user turn";
    expect(splitGrokUserMessageTexts(wrap(inner))).toEqual([inner]);
  });

  it("splits concatenated full envelopes into one inner per send", () => {
    expect(
      splitGrokUserMessageTexts(
        `${wrap("first steer")}${wrap("second steer")}`,
      ),
    ).toEqual(["first steer", "second steer"]);
  });

  it("splits a prompt glued to a following interject envelope", () => {
    const first =
      "grok message acknowledgment gap:\ndisplayed\nso i'm saying: use handles";
    const second =
      "you know better than i what additional client resident turns data model exists";
    const glued = `${first}${WRAP_SUFFIX}${WRAP_PREFIX}${second}`;
    expect(splitGrokUserMessageTexts(glued)).toEqual([first, second]);
  });

  it("splits envelopes glued without a newline after the first suffix", () => {
    expect(
      splitGrokUserMessageTexts(
        `${wrap("first steer")}${WRAP_PREFIX}second steer${WRAP_SUFFIX}`,
      ),
    ).toEqual(["first steer", "second steer"]);
  });
});

describe("grokInterjectAccepted", () => {
  it("accepts Grok's ExtMethodResult envelope", () => {
    expect(grokInterjectAccepted({ result: { status: "queued" } })).toBe(true);
  });

  it("accepts a bare status payload", () => {
    expect(grokInterjectAccepted({ status: "queued" })).toBe(true);
  });

  it("rejects failures and unknown shapes", () => {
    expect(grokInterjectAccepted({ result: null, error: "no session" })).toBe(
      false,
    );
    expect(grokInterjectAccepted({ result: { status: "ok" } })).toBe(false);
    expect(grokInterjectAccepted({})).toBe(false);
    expect(grokInterjectAccepted(undefined)).toBe(false);
  });
});
