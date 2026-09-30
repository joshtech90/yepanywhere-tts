import type { VoiceInputButtonRef } from "./VoiceInputButton";
import styles from "./ViewerWindowActions.module.css";
import { useI18n } from "../i18n";

export function ComposerMicAction({
  voice,
  onActivate,
}: {
  voice?: VoiceInputButtonRef | null;
  onActivate?: () => void;
}) {
  const { t } = useI18n();
  const label = t(
    voice?.isListening ? "projectAppMicStop" : "projectAppMicStart",
  );
  return (
    <span className={styles.actions}>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={voice?.isListening ?? false}
        disabled={!voice?.isAvailable}
        onClick={() => {
          onActivate?.();
          voice?.toggle();
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path
            d={
              voice?.isListening
                ? "M6 6h12v12H6z"
                : "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"
            }
          />
        </svg>
      </button>
    </span>
  );
}
