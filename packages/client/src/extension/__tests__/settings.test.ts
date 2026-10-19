import { describe, expect, it } from "vitest";
import { allowlistPermits } from "../settings";

describe("allowlistPermits", () => {
  it("permits everything when empty and matches repos, owners and Jira projects", () => {
    expect(allowlistPermits([], "any/repo#1")).toBe(true);
    const list = ["TomFitAG/*", "kzahel/yepanywhere", "TF", ""];
    expect(allowlistPermits(list, "tomfitag/tomfit-api#482")).toBe(true);
    expect(allowlistPermits(list, "kzahel/yepanywhere#9")).toBe(true);
    expect(allowlistPermits(list, "kzahel/other#9")).toBe(false);
    expect(allowlistPermits(list, "TF-3996")).toBe(true);
    expect(allowlistPermits(list, "TFX-1")).toBe(false);
    // An owner wildcard never admits a same-prefix owner.
    expect(allowlistPermits(["tomfit/*"], "tomfitag/api#1")).toBe(false);
  });
});
