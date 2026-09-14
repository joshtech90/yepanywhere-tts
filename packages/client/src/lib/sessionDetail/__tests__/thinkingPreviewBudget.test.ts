import { describe, expect, it } from "vitest";
import {
  conversationRowHeightCeilingPx,
  stackedThinkingBudgetPx,
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
