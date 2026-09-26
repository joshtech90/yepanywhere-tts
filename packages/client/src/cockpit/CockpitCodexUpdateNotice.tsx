import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCodexUpdateStatus } from "../hooks/useCodexUpdateStatus";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import {
  readSeenCodexUpdateTag,
  writeSeenCodexUpdateTag,
} from "../lib/codexUpdateSeen";
import { createCockpitNavigation } from "./core/navigation";
import styles from "./CockpitCodexUpdateNotice.module.css";

export interface CockpitCodexUpdateNoticeProps {
  basePath: string;
}

export function CockpitCodexUpdateNotice({
  basePath,
}: CockpitCodexUpdateNoticeProps) {
  const { t } = useI18n();
  const { settings } = useServerSettings();
  const policy = settings?.codexUpdatePolicy;
  const { status } = useCodexUpdateStatus({ enabled: policy === "notify" });
  const [seenTag, setSeenTag] = useState(readSeenCodexUpdateTag);

  useEffect(() => {
    setSeenTag(readSeenCodexUpdateTag());
  }, []);

  const latestTag = status?.latest ?? null;
  if (
    policy !== "notify" ||
    !status?.updateAvailable ||
    !latestTag ||
    latestTag === seenTag
  ) {
    return null;
  }

  const navigation = createCockpitNavigation(basePath);
  const dismiss = () => {
    writeSeenCodexUpdateTag(latestTag);
    setSeenTag(latestTag);
  };

  return (
    <aside aria-label={t("cockpitCodexUpdateAria")} className={styles.root}>
      <p className={styles.copy} role="status">
        <strong>{t("cockpitCodexUpdateTitle")}</strong>{" "}
        {t("cockpitCodexUpdateBody", {
          current: status.installed ?? t("cockpitCodexUpdateUnknownVersion"),
          latest: latestTag,
        })}
      </p>
      <div className={styles.actions}>
        <button onClick={dismiss} type="button">
          {t("cockpitCodexUpdateLater")}
        </button>
        <Link to={navigation.settings}>{t("cockpitCodexUpdateReview")}</Link>
      </div>
    </aside>
  );
}
