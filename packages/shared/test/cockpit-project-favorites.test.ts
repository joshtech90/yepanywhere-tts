import { describe, expect, it } from "vitest";
import {
  MAX_COCKPIT_PROJECT_FAVORITE_LABEL_LENGTH,
  MAX_COCKPIT_PROJECT_FAVORITES,
  normalizeCockpitProjectFavorites,
} from "../src/cockpit-project-favorites.js";

describe("normalizeCockpitProjectFavorites", () => {
  it("refuses anything that is not a list", () => {
    expect(normalizeCockpitProjectFavorites(undefined)).toBeNull();
    expect(normalizeCockpitProjectFavorites({ path: "/a" })).toBeNull();
    expect(normalizeCockpitProjectFavorites("nope")).toBeNull();
  });

  it("keeps usable entries, trimmed, first spelling of a path wins", () => {
    expect(
      normalizeCockpitProjectFavorites([
        { path: " /work/os ", label: " SZ OS " },
        { path: "/work/os", label: "Duplicate" },
        { path: "", label: "No path" },
        { path: "/work/x", label: "   " },
        { path: "/work/\0bad", label: "Nul" },
        { path: 42, label: "Number" },
        null,
        { path: "/work/autos", label: "China Autos" },
      ]),
    ).toEqual([
      { path: "/work/os", label: "SZ OS" },
      { path: "/work/autos", label: "China Autos" },
    ]);
  });

  it("caps labels and the list length", () => {
    const favorites = normalizeCockpitProjectFavorites(
      Array.from({ length: MAX_COCKPIT_PROJECT_FAVORITES + 5 }, (_, i) => ({
        path: `/work/${i}`,
        label: "x".repeat(MAX_COCKPIT_PROJECT_FAVORITE_LABEL_LENGTH + 10),
      })),
    );
    expect(favorites).toHaveLength(MAX_COCKPIT_PROJECT_FAVORITES);
    expect(favorites?.[0]?.label).toHaveLength(
      MAX_COCKPIT_PROJECT_FAVORITE_LABEL_LENGTH,
    );
  });
});
