import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../i18n";
import styles from "./RendezAttachment.module.css";

/** Countdown updates stay local to the attachment, independent of typing. */
export function RendezAttachment({
  sendAt,
  hasText,
  children,
}: {
  sendAt: number | null;
  hasText: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);
  const counting = sendAt !== null && !hasText && sendAt > now;
  useEffect(() => {
    let timer: number | undefined;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (sendAt === null || time >= sendAt) window.clearInterval(timer);
    };
    const refresh = () => {
      window.clearInterval(timer);
      tick();
      if (
        !document.hidden &&
        !hasText &&
        sendAt !== null &&
        sendAt > Date.now()
      )
        timer = window.setInterval(tick, 200);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sendAt, hasText]);
  const seconds =
    sendAt === null ? 0 : Math.max(0, Math.ceil((sendAt - now) / 1000));
  return (
    <div className={styles.root}>
      <div
        className={`${styles.preview} ${counting ? styles.counting : ""}`}
        style={
          {
            "--rendez-progress": `${Math.min(100, seconds * 10)}%`,
          } as CSSProperties
        }
      >
        {children}
        {counting && <span className={styles.progress} aria-hidden="true" />}
      </div>
      <span className={styles.status}>
        {counting
          ? t("rendezSendsIn", { seconds })
          : t("rendezReadyWithMessage")}
        {counting && <small>{t("rendezTypeToKeepDraft")}</small>}
      </span>
    </div>
  );
}
