import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { SettingsSection } from "./SettingsSection";

/** Default-off MCP App hosting (topics/mcp-apps.md); absent on older servers. */
export function McpAppViewsSettings() {
  const { t } = useI18n();
  const { version } = useVersion();
  const { settings, updateSetting } = useServerSettings();
  if (
    !settings ||
    !serverHasCapability(version, SERVER_CAPABILITIES.mcpAppViews.name)
  )
    return null;
  return (
    <SettingsSection
      title={t("mcpAppViewsSettingTitle")}
      description={t("mcpAppViewsSettingDescription")}
      keywords={["MCP", "MCP Apps", "Codex"]}
    >
      <label
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={settings.mcpAppViews === true}
          onChange={(event) =>
            updateSetting("mcpAppViews", event.target.checked)
          }
        />
        <span>{t("mcpAppViewsSettingTitle")}</span>
      </label>
    </SettingsSection>
  );
}
