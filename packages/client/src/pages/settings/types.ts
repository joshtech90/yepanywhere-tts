export interface SettingsCategory {
  id: string;
  label: string;
  description: string;
  /** Server support this category's pane needs; absent means every server. */
  requires?: SettingsCategoryRequirement;
}

/**
 * A capability-gated settings category. Settings, not the pane, owns the
 * answer for a server without it: the category leaves the list and search,
 * and a typed URL shows `unsupportedMessage` without mounting the pane.
 */
export interface SettingsCategoryRequirement {
  /** Server capability names; the pane is served when any one is present. */
  anyCapability: readonly string[];
  /** Shown in place of the pane on a server with none of them. */
  unsupportedMessage: string;
}
