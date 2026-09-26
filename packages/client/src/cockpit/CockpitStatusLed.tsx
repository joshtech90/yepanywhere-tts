import type { CockpitLedTone } from "./core/statusLed";
import styles from "./CockpitStatusLed.module.css";

export interface CockpitStatusLedProps {
  label: string;
  tone: CockpitLedTone;
}

/** A coloured dot whose meaning is carried by its accessible name. */
export function CockpitStatusLed({ label, tone }: CockpitStatusLedProps) {
  return (
    <span
      aria-label={label}
      className={styles.led}
      data-tone={tone}
      role="img"
      title={label}
    />
  );
}
