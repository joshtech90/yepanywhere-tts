import { describe, expect, it } from "vitest";
import {
  getEmulatorCategory,
  getSettingsCategories,
} from "../../../i18n-settings";
import {
  settingsCategoryEmojiIcons,
  settingsCategoryIcons,
} from "../SettingsCategoryIcons";

/**
 * A category with no entry here renders a blank space where every neighbour
 * shows a mark, and the gap is invisible in the source: the registry is a
 * plain object keyed by id, so nothing else fails when one is forgotten.
 */
describe("settings category icons", () => {
  const ids = [
    ...getSettingsCategories((key) => key).map((category) => category.id),
    getEmulatorCategory((key) => key).id,
  ];

  it("covers every category in both icon styles", () => {
    expect(ids.filter((id) => !settingsCategoryIcons[id])).toEqual([]);
    expect(ids.filter((id) => !settingsCategoryEmojiIcons[id])).toEqual([]);
  });
});
