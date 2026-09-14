import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpeechVocabularyChart, {
  rankVocabulary,
} from "../SpeechVocabularyChart";
import {
  parseVocabularyBaseline,
  VOCABULARY_BASELINE_URL,
} from "../vocabulary-baseline";
import { I18nProvider } from "../../../i18n";

afterEach(() => vi.unstubAllGlobals());

describe("learned vocabulary exploration", () => {
  it("ranks repeated excess use rather than tiny baseline ratios", () => {
    const baseline = new Map([
      ["the", 0.1],
      ["compiler", 0.0001],
      ["rare", 1e-9],
      ["rarer", 4e-9],
    ]);
    const ranked = rankVocabulary(
      [
        { word: "the", user: 100, assistant: 0 },
        { word: "compiler", user: 50, assistant: 10 },
        { word: "rare", user: 6, assistant: 0 },
        { word: "rarer", user: 6, assistant: 0 },
        { word: "typo", user: 1, assistant: 0 },
      ],
      1000,
      baseline,
      6,
      true,
    );
    expect(ranked.map((word) => word.word)).toEqual([
      "compiler",
      "rare",
      "rarer",
    ]);
    expect(Math.abs(ranked[1]!.score - ranked[2]!.score)).toBeLessThan(0.001);
    expect(
      parseVocabularyBaseline("the 100\ncompiler 10\n").get("compiler"),
    ).toBeCloseTo(1 / 11);
    expect(() => parseVocabularyBaseline("the nope")).toThrow();
  });

  it("loads its reference on mount and exposes exact counts through keyboard focus", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("the 100000\ncompiler 10\ntoken 10\n"));
    vi.stubGlobal("fetch", fetch);
    render(
      <I18nProvider>
        <SpeechVocabularyChart
          status={{
            generation: 0,
            enabled: true,
            biasing: false,
            sessionMultiplier: 5,
            sessionShare: 0,
            hours: 24,
            totals: { words: 3, user: 46, assistant: 10 },
            words: [
              { word: "compiler", user: 30, assistant: 10 },
              { word: "the", user: 10, assistant: 0 },
              { word: "token", user: 6, assistant: 0 },
            ],
            scan: { state: "idle", sessions: 1, messages: 1 },
            integration: "grok-via-ya",
          }}
        />
      </I18nProvider>,
    );
    const wordButton = await screen.findByRole("button", {
      name: /compiler: 40 occurrences/,
    });
    expect(fetch).toHaveBeenCalledWith(
      VOCABULARY_BASELINE_URL,
      expect.objectContaining({ credentials: "omit" }),
    );
    fireEvent.focus(wordButton);
    await waitFor(() =>
      expect(wordButton.getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByText(/compiler: 40 occurrences/).textContent).toContain(
      "30 user · 10 agent",
    );
    expect(screen.getByRole("table")).toBeTruthy();
    const token = screen.getByRole("button", { name: /token: 6 occurrences/ });
    expect(token.closest("tr")!.title).toContain("token: 6 occurrences");
    fireEvent.click(token);
    expect(token.getAttribute("aria-pressed")).toBe("true");
    expect(token.closest("tr")!.nextElementSibling?.textContent).toContain(
      "token: 6 occurrences",
    );
    expect(screen.queryByText(/compiler: 40 occurrences/)).toBeNull();
  });
});
