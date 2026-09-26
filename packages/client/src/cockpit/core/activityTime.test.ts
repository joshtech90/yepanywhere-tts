import { describe, expect, it } from "vitest";
import { formatCockpitActivityTime } from "./activityTime";

const NOW = new Date(2026, 8, 25, 9, 41);

describe("formatCockpitActivityTime", () => {
  it("shows only the clock for today", () => {
    expect(
      formatCockpitActivityTime(
        new Date(2026, 8, 25, 8, 5).toISOString(),
        "de",
        NOW,
      )?.label,
    ).toBe("08:05");
  });

  it("shows day and month for older days of this year", () => {
    expect(
      formatCockpitActivityTime(
        new Date(2026, 8, 24, 18, 20).toISOString(),
        "de",
        NOW,
      )?.label,
    ).toBe("24.09.");
  });

  it("adds the year for earlier years and keeps the full date as title", () => {
    const time = formatCockpitActivityTime(
      new Date(2025, 11, 31, 23, 0).toISOString(),
      "de",
      NOW,
    );
    expect(time?.label).toBe("31.12.25");
    expect(time?.title).toContain("2025");
  });

  it("returns nothing for missing or broken values", () => {
    expect(formatCockpitActivityTime(undefined, "de", NOW)).toBeNull();
    expect(formatCockpitActivityTime("kaputt", "de", NOW)).toBeNull();
  });
});
