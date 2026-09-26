import { useI18n } from "../i18n";
import styles from "./CockpitAppearanceControls.module.css";
import {
  COCKPIT_ACCENTS,
  COCKPIT_THEMES,
  type CockpitAccent,
  type CockpitTheme,
} from "./core/appearance";

export interface CockpitAppearanceControlsProps {
  accent: CockpitAccent;
  theme: CockpitTheme;
  onAccentChange: (accent: CockpitAccent) => void;
  onThemeChange: (theme: CockpitTheme) => void;
}

export function CockpitAppearanceControls({
  accent,
  theme,
  onAccentChange,
  onThemeChange,
}: CockpitAppearanceControlsProps) {
  const { t } = useI18n();
  const themeLabels: Record<CockpitTheme, string> = {
    auto: t("themeAuto"),
    light: t("themeLight"),
    dark: t("themeDark"),
  };
  const accentLabels: Record<CockpitAccent, string> = {
    blue: t("cockpitAccentBlue"),
    violet: t("cockpitAccentViolet"),
    teal: t("cockpitAccentTeal"),
    coral: t("cockpitAccentCoral"),
  };

  return (
    <div className={styles.root}>
      <fieldset className={styles.controlGroup}>
        <legend className={styles.controlLabel}>
          {t("appearanceThemeTitle")}
        </legend>
        <div className={styles.segmentedControl}>
          {COCKPIT_THEMES.map((choice) => (
            <button
              aria-pressed={theme === choice}
              className={styles.segmentButton}
              key={choice}
              onClick={() => onThemeChange(choice)}
              type="button"
            >
              {themeLabels[choice]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.controlGroup}>
        <legend className={styles.controlLabel}>
          {t("cockpitAccentTitle")}
        </legend>
        <div className={styles.accentChoices}>
          {COCKPIT_ACCENTS.map((choice) => (
            <button
              aria-label={t("cockpitAccentAria", {
                accent: accentLabels[choice],
              })}
              aria-pressed={accent === choice}
              className={styles.accentButton}
              data-accent-choice={choice}
              key={choice}
              onClick={() => onAccentChange(choice)}
              title={accentLabels[choice]}
              type="button"
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
