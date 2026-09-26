import type {
  EffortLevel,
  ModelInfo,
  PermissionMode,
  ThinkingMode,
} from "@yep-anywhere/shared";
import { useId } from "react";
import { useI18n } from "../i18n";
import type { EffortLevelOption } from "../lib/effortLevels";
import styles from "./CockpitRunSettings.module.css";

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

function Segments<T extends string>({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  value: T;
}) {
  return (
    <div aria-label={label} className={styles.segments} role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className={styles.segment}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          title={option.title}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "GPT-6-Luna · gpt-6-luna" says the same thing twice; keep one. */
function modelLabel(model: ModelInfo): string {
  if (!model.name || model.name.toLowerCase() === model.id.toLowerCase()) {
    return model.name || model.id;
  }
  return `${model.name} · ${model.id}`;
}

export interface CockpitModelFieldProps {
  disabled?: boolean;
  models: ModelInfo[];
  onChange: (model: string) => void;
  value: string | null;
}

/** Model picker; a model the provider no longer lists stays selectable. */
export function CockpitModelField({
  disabled,
  models,
  onChange,
  value,
}: CockpitModelFieldProps) {
  const { t } = useI18n();
  const id = useId();
  const listed = value === null || models.some((model) => model.id === value);
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {t("newSessionModelTitle")}
      </label>
      <select
        className={styles.select}
        disabled={disabled || (models.length === 0 && listed)}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value ?? ""}
      >
        {value === null && (
          <option value="">{t("processInfoDefaultModel")}</option>
        )}
        {!listed && value !== null && <option value={value}>{value}</option>}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {modelLabel(model)}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface CockpitThinkingFieldProps {
  disabled?: boolean;
  effort: EffortLevel;
  effortOptions: EffortLevelOption[];
  mode: ThinkingMode;
  modes: ThinkingMode[];
  onEffortChange: (effort: EffortLevel) => void;
  onModeChange: (mode: ThinkingMode) => void;
}

/**
 * Thinking as one row: Off, Auto, then the effort levels directly. Choosing a
 * level means "think at this level", so a separate On switch is not needed.
 */
export function CockpitThinkingField({
  disabled,
  effort,
  effortOptions,
  mode,
  modes,
  onEffortChange,
  onModeChange,
}: CockpitThinkingFieldProps) {
  const { t } = useI18n();
  const options: SegmentOption<string>[] = [];
  if (modes.includes("off")) {
    options.push({ value: "off", label: t("modelSettingsThinkingOffLabel") });
  }
  if (modes.includes("auto")) {
    options.push({ value: "auto", label: t("modelSettingsThinkingAutoLabel") });
  }
  if (modes.includes("on")) {
    for (const option of effortOptions) {
      options.push({
        value: `on:${option.value}`,
        label: option.label,
        title: option.description,
      });
    }
  }
  const value = mode === "on" ? `on:${effort}` : mode;
  return (
    <div className={styles.field}>
      <span className={styles.label}>{t("cockpitRunThinkingLabel")}</span>
      <Segments
        disabled={disabled}
        label={t("cockpitRunThinkingLabel")}
        onChange={(next) => {
          if (next === "off" || next === "auto") {
            onModeChange(next);
            return;
          }
          onModeChange("on");
          onEffortChange(next.slice(3) as EffortLevel);
        }}
        options={options}
        value={value}
      />
    </div>
  );
}

export interface CockpitPermissionFieldProps {
  disabled?: boolean;
  modes: PermissionMode[];
  onChange: (mode: PermissionMode) => void;
  value: PermissionMode;
}

export function CockpitPermissionField({
  disabled,
  modes,
  onChange,
  value,
}: CockpitPermissionFieldProps) {
  const { t } = useI18n();
  const labels: Record<PermissionMode, string> = {
    default: t("modeDefaultLabel"),
    acceptEdits: t("modeAcceptEditsLabel"),
    plan: t("modePlanLabel"),
    bypassPermissions: t("modeBypassPermissionsLabel"),
    auto: t("modeAutoLabel"),
  };
  const descriptions: Record<PermissionMode, string> = {
    default: t("modeDefaultDescription"),
    acceptEdits: t("modeAcceptEditsDescription"),
    plan: t("modePlanDescription"),
    bypassPermissions: t("modeBypassPermissionsDescription"),
    auto: t("modeAutoDescription"),
  };
  return (
    <div className={styles.field}>
      <span className={styles.label}>{t("newSessionModeTitle")}</span>
      <Segments
        disabled={disabled}
        label={t("newSessionModeTitle")}
        onChange={onChange}
        options={modes.map((mode) => ({
          value: mode,
          label: labels[mode],
          title: descriptions[mode],
        }))}
        value={value}
      />
      <p className={styles.hint}>{descriptions[value]}</p>
    </div>
  );
}
