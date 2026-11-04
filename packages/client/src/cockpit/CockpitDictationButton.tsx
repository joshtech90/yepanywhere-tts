import { useI18n } from "../i18n";
import type { useCockpitDictation } from "./useCockpitDictation";

/** The mic toggle; renders nothing where the server offers no dictation. */
export function CockpitDictationButton({
  className,
  dictation,
}: {
  className: string | undefined;
  dictation: ReturnType<typeof useCockpitDictation>;
}) {
  const { t } = useI18n();
  if (!dictation.available) return null;
  const label =
    dictation.state === "recording"
      ? t("cockpitDictationStop")
      : dictation.state === "transcribing"
        ? t("cockpitDictationTranscribing")
        : t("cockpitDictationStart");
  return (
    <button
      aria-label={label}
      aria-pressed={dictation.state === "recording"}
      className={className}
      data-state={dictation.state}
      disabled={dictation.state === "transcribing"}
      onClick={dictation.toggle}
      title={label}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        {dictation.state === "recording" ? (
          <rect height="9" rx="1.5" width="9" x="7.5" y="7.5" />
        ) : (
          <>
            <rect height="11" rx="3" width="6" x="9" y="3.5" />
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
          </>
        )}
      </svg>
    </button>
  );
}
