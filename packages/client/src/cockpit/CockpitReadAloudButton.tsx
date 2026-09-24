import { useCallback, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import {
  getReadAloudState,
  getReadAloudToken,
  playReadAloud,
  stopReadAloud,
  subscribeReadAloud,
} from "../lib/readAloud";
import styles from "./CockpitReadAloudButton.module.css";

export interface CockpitReadAloudButtonProps {
  id: string;
  text: string;
}

function readAloudSnapshot(): string {
  return `${getReadAloudState()}\0${getReadAloudToken() ?? ""}`;
}

function SpeakerIcon({ stop }: { stop: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {stop ? (
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
      ) : (
        <>
          <path d="M5 9.5h3.2L12 6v12l-3.8-3.5H5z" />
          <path d="M15.2 9a4.2 4.2 0 0 1 0 6M17.6 6.7a7.3 7.3 0 0 1 0 10.6" />
        </>
      )}
    </svg>
  );
}

export function CockpitReadAloudButton({
  id,
  text,
}: CockpitReadAloudButtonProps) {
  const { t } = useI18n();
  useSyncExternalStore(
    subscribeReadAloud,
    readAloudSnapshot,
    () => "idle\0",
  );
  const active =
    getReadAloudToken() === id && getReadAloudState() !== "idle";
  const loading = active && getReadAloudState() === "loading";
  const actionLabel = active
    ? t("cockpitSessionReadAloudStop")
    : t("cockpitSessionReadAloud");
  const visibleLabel = loading
    ? t("cockpitSessionReadAloudPreparing")
    : actionLabel;
  const handleClick = useCallback(() => {
    if (active) {
      stopReadAloud();
      return;
    }
    void playReadAloud(text, id);
  }, [active, id, text]);

  return (
    <button
      aria-label={actionLabel}
      aria-pressed={active}
      className={styles.button}
      data-state={loading ? "loading" : active ? "playing" : "idle"}
      onClick={handleClick}
      title={actionLabel}
      type="button"
    >
      <SpeakerIcon stop={active} />
      <span>{visibleLabel}</span>
    </button>
  );
}
