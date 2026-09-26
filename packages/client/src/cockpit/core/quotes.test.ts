import { describe, expect, it } from "vitest";
import { COCKPIT_QUOTES, pickCockpitQuote } from "./quotes";

describe("pickCockpitQuote", () => {
  it("starts anywhere in the collection", () => {
    expect(pickCockpitQuote(null, () => 0, 5)).toBe(0);
    expect(pickCockpitQuote(null, () => 0.9999, 5)).toBe(4);
  });

  it("never repeats the quote just shown", () => {
    for (let current = 0; current < 5; current += 1) {
      for (const draw of [0, 0.2, 0.5, 0.8, 0.9999]) {
        const next = pickCockpitQuote(current, () => draw, 5);
        expect(next).not.toBe(current);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(5);
      }
    }
  });

  it("keeps a single quote when there is nothing else", () => {
    expect(pickCockpitQuote(0, () => 0.5, 1)).toBe(0);
  });
});

describe("COCKPIT_QUOTES", () => {
  it("has complete, short entries without dashes", () => {
    expect(COCKPIT_QUOTES.length).toBeGreaterThan(20);
    for (const quote of COCKPIT_QUOTES) {
      expect(quote.text.trim()).not.toBe("");
      expect(quote.author.trim()).not.toBe("");
      expect(quote.work.trim()).not.toBe("");
      expect(quote.text.length).toBeLessThanOrEqual(240);
      expect(quote.text).not.toMatch(/[–—]/);
    }
  });
});
