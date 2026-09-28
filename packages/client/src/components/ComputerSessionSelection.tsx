import { useEffect, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useI18n } from "../i18n";
import { FilterDropdown } from "./FilterDropdown";
import styles from "./ComputerSessionSelection.module.css";

export function ComputerSessionSelection({
  eligible,
  selected,
  onChange,
  disabled = false,
  showCaption = false,
}: {
  eligible: boolean;
  selected: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  showCaption?: boolean;
}) {
  const { transport } = useCurrentSourceRuntime();
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    setAvailable(false);
    onChange(false);
    if (eligible)
      void transport
        .fetch<{ enabled: boolean; available: boolean }>("/computer-control")
        .then((status) => {
          if (!disposed) setAvailable(status.enabled && status.available);
        })
        .catch(() => {
          /* Optional readiness stays unavailable on failure. */
        });
    return () => {
      disposed = true;
    };
  }, [transport, eligible, onChange]);
  if (!available || !eligible) return null;
  return (
    <div className={`new-session-helper-section ${styles.section}`}>
      <h3>{t("newSessionComputerControlTitle")}</h3>
      <FilterDropdown<"off" | "on">
        label={t("newSessionComputerControlTitle")}
        options={[
          { value: "off", label: t("showThinkingOff"), disabled },
          {
            value: "on",
            label: t("showThinkingOn"),
            disabled,
          },
        ]}
        selected={[selected ? "on" : "off"]}
        onChange={([value]) => {
          if (!disabled) onChange(value === "on");
        }}
        multiSelect={false}
        fullWidth
        triggerClassName={styles.leftAlignedTrigger}
      />
      {showCaption && (
        <p className={styles.caption}>{t("computerSessionScope")}</p>
      )}
    </div>
  );
}
