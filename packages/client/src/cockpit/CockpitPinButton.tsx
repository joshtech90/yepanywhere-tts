import { useI18n } from "../i18n";
import styles from "./CockpitPinButton.module.css";

export interface CockpitPinButtonProps {
  pending: boolean;
  pinned: boolean;
  sessionTitle: string;
  onToggle: () => void;
}

export function CockpitPinButton({
  pending,
  pinned,
  sessionTitle,
  onToggle,
}: CockpitPinButtonProps) {
  const { t } = useI18n();
  const label = t(pinned ? "cockpitUnpinSession" : "cockpitPinSession", {
    name: sessionTitle,
  });

  return (
    <button
      aria-label={label}
      aria-pressed={pinned}
      className={styles.button}
      data-pending={pending ? "true" : "false"}
      disabled={pending}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3Z" />
      </svg>
    </button>
  );
}
