import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
  normalizeAutoSessionTitleSettings,
  normalizeGeneratedSessionTitle,
} from "../src/auto-session-title.js";

describe("normalizeAutoSessionTitleSettings", () => {
  it("returns defaults for junk input", () => {
    expect(normalizeAutoSessionTitleSettings(undefined)).toEqual(
      DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
    );
    expect(normalizeAutoSessionTitleSettings("nope")).toEqual(
      DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
    );
    expect(normalizeAutoSessionTitleSettings(null)).toEqual(
      DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
    );
  });

  it("clamps out-of-range numbers instead of rejecting the object", () => {
    const result = normalizeAutoSessionTitleSettings({
      enabled: true,
      maxLength: 9999,
      delaySeconds: -40,
      triggerMessageCount: 0,
    });
    expect(result.enabled).toBe(true);
    expect(result.maxLength).toBe(132);
    expect(result.delaySeconds).toBe(0);
    expect(result.triggerMessageCount).toBe(1);
  });

  it("rounds fractional numbers", () => {
    expect(
      normalizeAutoSessionTitleSettings({ triggerMessageCount: 3.6 })
        .triggerMessageCount,
    ).toBe(4);
  });

  it("falls back to the base value for an unknown language", () => {
    expect(normalizeAutoSessionTitleSettings({ language: "klingon" }).language)
      .toBe("auto");
    expect(normalizeAutoSessionTitleSettings({ language: "de" }).language).toBe(
      "de",
    );
  });

  it("merges a partial patch onto an explicit base", () => {
    const base = normalizeAutoSessionTitleSettings({
      enabled: true,
      maxLength: 60,
      language: "de",
    });
    const patched = normalizeAutoSessionTitleSettings({ enabled: false }, base);
    expect(patched).toEqual({ ...base, enabled: false });
  });
});

describe("normalizeGeneratedSessionTitle", () => {
  it("keeps a clean title unchanged", () => {
    expect(normalizeGeneratedSessionTitle("Stripe anfragen")).toBe(
      "Stripe anfragen",
    );
  });

  it("strips a label prefix, quotes and trailing punctuation", () => {
    expect(normalizeGeneratedSessionTitle('Title: "Telegram-Bot Deploy".')).toBe(
      "Telegram-Bot Deploy",
    );
    expect(normalizeGeneratedSessionTitle("Titel — Wohnungssuche")).toBe(
      "Wohnungssuche",
    );
    expect(normalizeGeneratedSessionTitle("## Rechnungen sortieren")).toBe(
      "Rechnungen sortieren",
    );
  });

  it("takes the first non-empty line when the model adds a preamble", () => {
    expect(
      normalizeGeneratedSessionTitle("\n\nWohnungssuche Kleinanzeigen\n\nWhy: …"),
    ).toBe("Wohnungssuche Kleinanzeigen");
  });

  it("returns undefined when nothing usable is left", () => {
    expect(normalizeGeneratedSessionTitle("")).toBeUndefined();
    expect(normalizeGeneratedSessionTitle("   \n  ")).toBeUndefined();
    expect(normalizeGeneratedSessionTitle('"""')).toBeUndefined();
  });

  it("cuts at a word boundary when over the limit", () => {
    const result = normalizeGeneratedSessionTitle(
      "Wohnungssuche Kleinanzeigen Koeln Lindenthal Altbau",
      20,
    );
    expect(result).toBe("Wohnungssuche");
    expect((result ?? "").length).toBeLessThanOrEqual(20);
  });

  it("hard-cuts when there is no late word boundary", () => {
    const result = normalizeGeneratedSessionTitle(
      "Donaudampfschifffahrtsgesellschaftskapitaen",
      20,
    );
    expect(result).toBe("Donaudampfschifffahr");
  });

  it("strips control characters that would corrupt a browser title", () => {
    expect(normalizeGeneratedSessionTitle("Stripe‮anfragen")).toBe(
      "Stripe anfragen",
    );
  });
});
