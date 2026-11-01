import { useCallback, useMemo } from "react";
import { useServerSettings } from "../../hooks/useServerSettings";
import {
  type SourceControlCleanLanding,
  useSourceControlCleanLanding,
} from "../../hooks/useSourceControlCleanLanding";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { SettingsItem } from "./SettingsItem";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import { SettingsSection } from "./SettingsSection";
import { useSettingsUndoBaseline } from "./SettingsUndoContext";

export function SourceControlSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("sourceControlSettingsTitle"));
  const { refetch: refetchVersion } = useVersion();

  const { settings, isLoading, error, updateSettings } = useServerSettings();
  const reviewsEnabled = settings?.sourceReviewSubmissionsEnabled ?? false;
  const liveWorktreeMonitoringEnabled =
    settings?.liveWorktreeMonitoringEnabled ?? false;
  const { sourceControlCleanLanding, setSourceControlCleanLanding } =
    useSourceControlCleanLanding();

  const undoState = useMemo(
    () =>
      settings
        ? {
            sourceControlCleanLanding,
            sourceReviewSubmissionsEnabled: reviewsEnabled,
            liveWorktreeMonitoringEnabled,
          }
        : null,
    [
      liveWorktreeMonitoringEnabled,
      reviewsEnabled,
      settings,
      sourceControlCleanLanding,
    ],
  );
  const restoreUndoState = useCallback(
    (snapshot: NonNullable<typeof undoState>) => {
      setSourceControlCleanLanding(snapshot.sourceControlCleanLanding);
      void updateSettings({
        sourceReviewSubmissionsEnabled: snapshot.sourceReviewSubmissionsEnabled,
        liveWorktreeMonitoringEnabled: snapshot.liveWorktreeMonitoringEnabled,
      })
        .then(() => refetchVersion())
        .catch(() => {
          // The hook keeps the actionable error visible in this pane.
        });
    },
    [refetchVersion, setSourceControlCleanLanding, updateSettings],
  );
  useSettingsUndoBaseline(undoState, restoreUndoState);

  if (isLoading) {
    return <SettingsSection description={t("sourceControlSettingsLoading")} />;
  }

  return (
    <SettingsSection
      description={t("sourceControlSettingsDescription")}
      doc="site/src/content/docs/files-and-source-control.md#source-control-page"
    >
      <div className="settings-group">
        <SettingsItem
          className="settings-item--wide-control"
          label={t("sourceControlCleanLandingTitle")}
          description={t("sourceControlCleanLandingDescription")}
          valueText={
            sourceControlCleanLanding === "latest-commit"
              ? t("sourceControlCleanLandingLatestCommit")
              : t("sourceControlCleanLandingWorkingTree")
          }
        >
          <select
            className="settings-select"
            aria-label={t("sourceControlCleanLandingTitle")}
            value={sourceControlCleanLanding}
            onChange={(event) =>
              setSourceControlCleanLanding(
                event.target.value as SourceControlCleanLanding,
              )
            }
          >
            <option value="working-tree">
              {t("sourceControlCleanLandingWorkingTree")}
            </option>
            <option value="latest-commit">
              {t("sourceControlCleanLandingLatestCommit")}
            </option>
          </select>
        </SettingsItem>
        <SettingsItem
          as="label"
          label={t("sourceReviewSubmissionsSettingTitle")}
          description={t("sourceReviewSubmissionsSettingDescription")}
        >
          <span className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t("sourceReviewSubmissionsSettingTitle")}
              checked={reviewsEnabled}
              onChange={(event) => {
                void updateSettings({
                  sourceReviewSubmissionsEnabled: event.target.checked,
                }).catch(() => {
                  // The hook keeps the actionable error visible in this pane.
                });
              }}
            />
            <span className="toggle-slider" />
          </span>
        </SettingsItem>
        <SettingsItem
          as="label"
          label={t("liveWorktreeMonitoringSettingTitle")}
          description={t("liveWorktreeMonitoringSettingDescription")}
        >
          <span className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t("liveWorktreeMonitoringSettingTitle")}
              checked={liveWorktreeMonitoringEnabled}
              onChange={(event) => {
                void updateSettings({
                  liveWorktreeMonitoringEnabled: event.target.checked,
                })
                  .then(() => refetchVersion())
                  .catch(() => {
                    // The hook keeps the actionable error visible in this pane.
                  });
              }}
            />
            <span className="toggle-slider" />
          </span>
        </SettingsItem>
      </div>
      {error && <p className="settings-error">{error}</p>}
    </SettingsSection>
  );
}
