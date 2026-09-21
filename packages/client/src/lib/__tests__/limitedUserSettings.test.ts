import { describe, expect, it } from "vitest";
import { getSettingsCategories } from "../../i18n-settings";
import { limitedUserMaySeeSettingsCategory } from "../limitedUserSettings";

/** Contract: topics/limited-users.md § Delivery v1 — Settings → Users. */

describe("settings categories for a limited user", () => {
  it("keeps their own account and the browser-local panes", () => {
    for (const id of ["users", "appearance", "toolbar", "notifications"]) {
      expect(limitedUserMaySeeSettingsCategory(id)).toBe(true);
    }
  });

  it("drops panes whose routes they may not call", () => {
    // Local Access waits forever on /api/network-binding, which is denied;
    // the rest are host administration or other people's devices.
    for (const id of [
      "local-access",
      "remote",
      "devices",
      "apps",
      "environment",
      "development",
      "issues",
      "source-control",
      "storage",
    ]) {
      expect(limitedUserMaySeeSettingsCategory(id)).toBe(false);
    }
  });

  it("hides a category nobody listed, so a new pane is not shipped broken", () => {
    expect(limitedUserMaySeeSettingsCategory("some-new-pane")).toBe(false);
    // Every allowed id is a category that actually exists.
    const known = new Set(
      getSettingsCategories((key) => key).map((category) => category.id),
    );
    const allowed = getSettingsCategories((key) => key)
      .map((category) => category.id)
      .filter(limitedUserMaySeeSettingsCategory);
    expect(allowed.length).toBeGreaterThan(0);
    for (const id of allowed) expect(known.has(id)).toBe(true);
  });
});
