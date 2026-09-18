import { describe, expect, it } from "vitest";
import {
  cardsShareFlexLine,
  conversationRowHeightCeilingPx,
  stackedThinkingBudgetPx,
  stabilizePublishedPx,
} from "../thinkingPreviewBudget";

const tabletish = {
  viewportHeightPx: 600,
  trailingContentPx: 0,
  contextReservePx: 40,
  previousChromePx: 46,
};

describe("stackedThinkingBudgetPx", () => {
  it("gives the wrapped card the room left below the current one", () => {
    // The current card and the activity column fill the first 360px of the row,
    // so 600 - 40 reserved - 360 - 46 chrome is left for superseded thought.
    expect(
      stackedThinkingBudgetPx({ ...tabletish, previousTopPx: 360 }),
    ).toBeCloseTo(154);
  });

  it("cannot spend the transcript padding sitting below the row", () => {
    expect(
      stackedThinkingBudgetPx({
        ...tabletish,
        previousTopPx: 360,
        trailingContentPx: 54,
      }),
    ).toBeCloseTo(100);
  });

  it("drops the card when its content would be thinner than the paragraph it costs", () => {
    // 600 - 40 - 480 - 46 leaves 34px, under the two prose lines the card
    // displaces above the row, so the chrome is no longer paying for itself.
    expect(
      stackedThinkingBudgetPx({ ...tabletish, previousTopPx: 480 }),
    ).toBeNull();
  });

  it("keeps a card whose content exactly meets the minimum", () => {
    expect(
      stackedThinkingBudgetPx({
        ...tabletish,
        previousTopPx: 474,
      }),
    ).toBeCloseTo(40);
  });

  it("takes an explicit minimum over the context reserve", () => {
    expect(
      stackedThinkingBudgetPx({
        ...tabletish,
        previousTopPx: 474,
        minContentHeightPx: 80,
      }),
    ).toBeNull();
  });
});

describe("conversationRowHeightCeilingPx", () => {
  it("leaves the preceding paragraph visible above the row", () => {
    expect(conversationRowHeightCeilingPx(600, 40)).toBe(560);
  });

  it("never reports a negative ceiling for a viewport shorter than the reserve", () => {
    expect(conversationRowHeightCeilingPx(20, 40)).toBe(0);
  });
});

describe("stabilizePublishedPx", () => {
  it("takes the first measurement and grows at once", () => {
    expect(stabilizePublishedPx(null, 240)).toBe(240);
    expect(stabilizePublishedPx(240, 260)).toBe(260);
  });

  it("ignores a 2px shrink so a wrap/subpixel flap cannot publish", () => {
    expect(stabilizePublishedPx(242, 240)).toBe(242);
    expect(stabilizePublishedPx(242, 241)).toBe(242);
  });

  it("still publishes a real shrink past the deadband", () => {
    expect(stabilizePublishedPx(240, 200)).toBe(200);
  });
});

describe("cardsShareFlexLine", () => {
  it("treats a 2px wobble as still sharing a line when it already did", () => {
    expect(cardsShareFlexLine(0, true)).toBe(true);
    expect(cardsShareFlexLine(2, true)).toBe(true);
  });

  it("does not enter stacked from a 2px wobble on the first measure", () => {
    // First measure starts from "shared" (no data-previous-thinking yet).
    expect(cardsShareFlexLine(2, true)).toBe(true);
  });

  it("does not leave stacked for a 2px leftover once a real wrap happened", () => {
    expect(cardsShareFlexLine(2, false)).toBe(false);
  });

  it("classifies a real wrap and a true same-line immediately", () => {
    expect(cardsShareFlexLine(320, true)).toBe(false);
    expect(cardsShareFlexLine(0, false)).toBe(true);
  });
});
