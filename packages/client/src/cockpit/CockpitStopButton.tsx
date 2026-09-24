import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type {
  CockpitAttentionActionResult,
  CockpitAttentionPort,
} from "./useCockpitAttention";
import styles from "./CockpitStopButton.module.css";

export function CockpitStopButton({
  interruptible,
  stop,
}: Pick<CockpitAttentionPort, "interruptible" | "stop">) {
  const { t } = useI18n();
  const inFlightRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] =
    useState<CockpitAttentionActionResult | null>(null);
  const settled = result?.kind === "accepted" || result?.kind === "stale";

  useEffect(() => {
    if (interruptible) return;
    inFlightRef.current = false;
    setPending(false);
    setResult(null);
  }, [interruptible]);

  if (!interruptible) return null;

  const handleStop = async () => {
    if (inFlightRef.current || settled) return;
    inFlightRef.current = true;
    setPending(true);
    setResult(null);
    try {
      setResult(await stop());
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  return (
    <span className={styles.wrapper}>
      <button
        aria-label={t("cockpitStopAction")}
        className={styles.button}
        disabled={pending || settled}
        onClick={() => void handleStop()}
        type="button"
      >
        <span aria-hidden="true" className={styles.icon} />
        <span className={styles.label}>
          {pending
            ? t("cockpitStopPending")
            : settled
              ? t("cockpitStopAccepted")
              : t("cockpitStopAction")}
        </span>
      </button>
      {result?.kind === "error" && (
        <span className={styles.error} role="alert">
          {t("cockpitStopFailed", {
            message: result.message || t("cockpitAttentionUnknownError"),
          })}
        </span>
      )}
    </span>
  );
}
