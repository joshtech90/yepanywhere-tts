import { useNativePullToRefresh } from "../hooks/useNativePullToRefresh";
import { useI18n } from "../i18n";
import styles from "./NativePullToRefresh.module.css";

export function NativePullToRefresh({ onReload }: { onReload: () => void }) {
  const status = useNativePullToRefresh(onReload);
  const { t } = useI18n();
  if (status === "hidden") return null;
  return (
    <div className={styles.indicator} role="status">
      {t(status === "armed" ? "nativeRefreshRelease" : "nativeRefreshPull")}
    </div>
  );
}
