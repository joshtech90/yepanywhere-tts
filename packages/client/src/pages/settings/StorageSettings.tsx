import { useCallback, useMemo } from "react";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";
import { SettingsItem } from "./SettingsItem";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import { SettingsSection } from "./SettingsSection";
import { useSettingsUndoBaseline } from "./SettingsUndoContext";
import styles from "./StorageSettings.module.css";

interface StorageChoiceProps {
  name: string;
  value: string;
  label: string;
  description: string;
  checked: boolean;
  isDefault?: boolean;
  onChange: () => void;
}

function StorageChoice({
  name,
  value,
  label,
  description,
  checked,
  isDefault = false,
  onChange,
}: StorageChoiceProps) {
  const { t } = useI18n();
  return (
    <label
      className={`${styles.choice} ${checked ? styles.selected : ""}`.trim()}
    >
      <input
        type="radio"
        name={name}
        value={value}
        aria-label={label}
        checked={checked}
        onChange={onChange}
      />
      <span className={styles.choiceText}>
        <span className={styles.choiceHeading}>
          <span>{label}</span>
          {isDefault && (
            <span className={styles.defaultBadge}>
              {t("storageChoiceDefault")}
            </span>
          )}
        </span>
        <span className={styles.choiceDescription}>{description}</span>
      </span>
    </label>
  );
}

export function StorageSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("storageSettingsTitle"));

  const { settings, isLoading, error, updateSettings } = useServerSettings();
  const projectLocation = settings?.projectDirectoryStorage ?? "app-data";
  const mediaPreservation =
    settings?.toolResultMediaPreservation ?? "on-demand";

  const undoState = useMemo(
    () => (settings ? { projectLocation, mediaPreservation } : null),
    [mediaPreservation, projectLocation, settings],
  );
  const restoreUndoState = useCallback(
    (snapshot: NonNullable<typeof undoState>) => {
      void updateSettings({
        projectDirectoryStorage: snapshot.projectLocation,
        toolResultMediaPreservation: snapshot.mediaPreservation,
      }).catch(() => {
        // The hook keeps the actionable error visible in this pane.
      });
    },
    [updateSettings],
  );
  useSettingsUndoBaseline(undoState, restoreUndoState);

  if (isLoading) {
    return <SettingsSection description={t("storageSettingsLoading")} />;
  }

  return (
    <SettingsSection
      description={t("storageSettingsDescription")}
      keywords={[".yep", ".attachments", "YEP_DATA_DIR"]}
      doc="topics/storage-settings.md"
    >
      <div className="settings-group">
        <SettingsItem
          id="project-data-location"
          className={styles.setting}
          label={t("projectDataLocationTitle")}
          description={t("projectDataLocationDescription")}
          keywords={[".yep", ".attachments", "YEP_DATA_DIR"]}
          valueText={
            projectLocation === "project"
              ? t("projectDataLocationProject")
              : t("projectDataLocationAppData")
          }
        >
          <fieldset
            className={styles.choices}
            aria-label={t("projectDataLocationTitle")}
          >
            <StorageChoice
              name="project-data-location"
              value="app-data"
              label={t("projectDataLocationAppData")}
              description={t("projectDataLocationAppDataDescription")}
              checked={projectLocation === "app-data"}
              isDefault
              onChange={() => {
                void updateSettings({
                  projectDirectoryStorage: "app-data",
                }).catch(() => {
                  // The hook keeps the actionable error visible in this pane.
                });
              }}
            />
            <StorageChoice
              name="project-data-location"
              value="project"
              label={t("projectDataLocationProject")}
              description={t("projectDataLocationProjectDescription")}
              checked={projectLocation === "project"}
              onChange={() => {
                void updateSettings({
                  projectDirectoryStorage: "project",
                }).catch(() => {
                  // The hook keeps the actionable error visible in this pane.
                });
              }}
            />
          </fieldset>
        </SettingsItem>

        <SettingsItem
          id="tool-result-images"
          className={styles.setting}
          label={t("toolResultImagesStorageTitle")}
          description={t("toolResultImagesStorageDescription")}
          keywords={["tool results", "image", "preserve", "storage"]}
          valueText={
            mediaPreservation === "preserve"
              ? t("toolResultImagesPreserve")
              : t("toolResultImagesOnDemand")
          }
        >
          <fieldset
            className={styles.choices}
            aria-label={t("toolResultImagesStorageTitle")}
          >
            <StorageChoice
              name="tool-result-images"
              value="on-demand"
              label={t("toolResultImagesOnDemand")}
              description={t("toolResultImagesOnDemandDescription")}
              checked={mediaPreservation === "on-demand"}
              isDefault
              onChange={() => {
                void updateSettings({
                  toolResultMediaPreservation: "on-demand",
                }).catch(() => {
                  // The hook keeps the actionable error visible in this pane.
                });
              }}
            />
            <StorageChoice
              name="tool-result-images"
              value="preserve"
              label={t("toolResultImagesPreserve")}
              description={t("toolResultImagesPreserveDescription")}
              checked={mediaPreservation === "preserve"}
              onChange={() => {
                void updateSettings({
                  toolResultMediaPreservation: "preserve",
                }).catch(() => {
                  // The hook keeps the actionable error visible in this pane.
                });
              }}
            />
          </fieldset>
        </SettingsItem>
      </div>
      {error && <p className="settings-warning">{error}</p>}
    </SettingsSection>
  );
}
