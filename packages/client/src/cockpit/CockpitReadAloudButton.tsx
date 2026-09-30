import { useCallback, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import {
  getReadAloudFailedToken,
  getReadAloudState,
  getReadAloudToken,
  pauseReadAloud,
  playReadAloud,
  resumeReadAloud,
  stopReadAloud,
  subscribeReadAloud,
} from "../lib/readAloud";
import styles from "./CockpitReadAloudButton.module.css";

export interface CockpitReadAloudButtonProps {
  id: string;
  text: string;
}

function readAloudSnapshot(): string {
  return `${getReadAloudState()}\0${getReadAloudToken() ?? ""}\0${
    getReadAloudFailedToken() ?? ""
  }`;
}

type SpeakerIconKind = "speaker" | "stop" | "pause" | "resume";

function SpeakerIcon({ kind }: { kind: SpeakerIconKind }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {kind === "stop" ? (
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
      ) : kind === "pause" ? (
        <path d="M9 6.5v11M15 6.5v11" />
      ) : kind === "resume" ? (
        <path d="M8.5 6.5v11l9-5.5z" />
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
  useSyncExternalStore(subscribeReadAloud, readAloudSnapshot, () => "idle\0\0");
  const liveState = getReadAloudState();
  const active = getReadAloudToken() === id && liveState !== "idle";
  const loading = active && liveState === "loading";
  const playing = active && liveState === "playing";
  const paused = active && liveState === "paused";
  const failed = !active && getReadAloudFailedToken() === id;
  const actionLabel = playing
    ? t("cockpitSessionReadAloudPause")
    : paused
      ? t("cockpitSessionReadAloudResume")
      : loading
        ? t("cockpitSessionReadAloudStop")
        : failed
          ? t("cockpitSessionReadAloudRetry")
          : t("cockpitSessionReadAloud");
  const visibleLabel = loading
    ? t("cockpitSessionReadAloudPreparing")
    : failed
      ? t("cockpitSessionReadAloudFailed")
      : actionLabel;
  // Playing pauses and a pause resumes, like PocketClaude; while audio is
  // still being prepared the control cancels it.
  const handleClick = useCallback(() => {
    if (playing) {
      pauseReadAloud();
    } else if (paused) {
      resumeReadAloud();
    } else if (loading) {
      stopReadAloud();
    } else {
      void playReadAloud(text, id);
    }
  }, [id, loading, paused, playing, text]);

  return (
    <button
      aria-label={actionLabel}
      aria-pressed={active}
      className={styles.button}
      data-state={
        loading
          ? "loading"
          : playing
            ? "playing"
            : paused
              ? "paused"
              : failed
                ? "error"
                : "idle"
      }
      onClick={handleClick}
      title={actionLabel}
      type="button"
    >
      <SpeakerIcon
        kind={
          playing ? "pause" : paused ? "resume" : loading ? "stop" : "speaker"
        }
      />
      <span aria-live="polite">{visibleLabel}</span>
    </button>
  );
}
