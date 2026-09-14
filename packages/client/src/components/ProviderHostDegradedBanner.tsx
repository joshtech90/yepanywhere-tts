import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import styles from "./ProviderHostDegradedBanner.module.css";

export function shouldShowProviderHostDegradedBanner(
  version: { providerHostDegraded?: boolean } | null | undefined,
): boolean {
  return version?.providerHostDegraded === true;
}

export function ProviderHostDegradedBanner() {
  const { t } = useI18n();
  const { version } = useVersion();
  if (!shouldShowProviderHostDegradedBanner(version)) return null;

  return (
    <div
      className={styles.root}
      role="alert"
      data-provider-host-degraded="true"
    >
      <p className={styles.title}>{t("providerHostDegradedTitle")}</p>
      <p className={styles.body}>{t("providerHostDegradedDescription")}</p>
    </div>
  );
}
