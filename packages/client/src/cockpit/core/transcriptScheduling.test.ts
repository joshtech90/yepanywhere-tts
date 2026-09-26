import { describe, expect, it } from "vitest";
import { selectCockpitTranscriptSnapshot } from "./transcriptScheduling";

const entries = (...keys: string[]) => keys.map((key) => ({ key }));

describe("Cockpit transcript scheduling", () => {
  it("defers live tail work while controls can use current session state", () => {
    const deferred = entries("visible-first", "visible-last");
    const current = entries("visible-first", "visible-last", "live-tail");

    expect(selectCockpitTranscriptSnapshot(current, deferred)).toBe(deferred);
  });

  it("keeps prepend, trim, replacement, and first load immediate", () => {
    const deferred = entries("visible-first", "visible-last");
    const prepend = entries("older", "visible-first", "visible-last");
    const prefixTrim = entries("visible-last");
    const tailTrim = entries("visible-first");
    const replacement = entries("new-session-row");
    const firstLoad = entries("first-row");

    expect(selectCockpitTranscriptSnapshot(prepend, deferred)).toBe(prepend);
    expect(selectCockpitTranscriptSnapshot(prefixTrim, deferred)).toBe(
      prefixTrim,
    );
    expect(selectCockpitTranscriptSnapshot(tailTrim, deferred)).toBe(tailTrim);
    expect(selectCockpitTranscriptSnapshot(replacement, deferred)).toBe(
      replacement,
    );
    expect(selectCockpitTranscriptSnapshot(firstLoad, [])).toBe(firstLoad);
  });
});
