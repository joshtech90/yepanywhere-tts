import type { UsageReport, UsageTotals } from "@yep-anywhere/shared";
import { useI18n } from "../../i18n";
import styles from "./UsersSettings.module.css";

/**
 * Per-principal usage for Settings → Users.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage. Two columns per
 * user: everything the ledger holds, and the last seven days. The header
 * says how far back the ledger actually reaches, because it starts the day
 * the feature lands rather than covering the install's whole history.
 */

export interface UserUsageTableProps {
  report: UsageReport;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Interaction time as a short phrase: "3h 20m", "45m", "under a minute". */
export function formatActiveTime(
  ms: number,
  t: (key: never, vars?: Record<string, string | number>) => string,
): string {
  if (ms <= 0) return t("userUsageNone" as never);
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
  if (hours > 0) {
    return minutes > 0
      ? t("userUsageHoursMinutes" as never, { hours, minutes })
      : t("userUsageHours" as never, { hours });
  }
  if (minutes > 0) return t("userUsageMinutes" as never, { minutes });
  return t("userUsageUnderAMinute" as never);
}

/** Whole weeks the ledger covers, rounded up so a partial week reads as 1. */
export function coveredWeeks(since: number | null, now: number): number {
  if (since === null) return 0;
  const weekMs = 7 * 24 * HOUR_MS;
  return Math.max(1, Math.ceil((now - since) / weekMs));
}

export function UserUsageTable({ report }: UserUsageTableProps) {
  const { t } = useI18n();
  const weeks = coveredWeeks(report.since, report.now);
  // A principal with nothing recorded in either window is noise in the table.
  const rows = report.users.filter(
    (user) => user.total.turns > 0 || user.total.sessions > 0,
  );

  return (
    <div className={styles.usage}>
      <h3 className={styles.editorTitle}>{t("userUsageTitle")}</h3>
      <p className="settings-hint">
        {report.since === null
          ? t("userUsageEmpty")
          : weeks > 1
            ? t("userUsageSince", { weeks })
            : t("userUsageSinceWeek")}
      </p>
      {rows.length > 0 && (
        <table className={styles.usageTable}>
          <thead>
            <tr>
              <th scope="col">{t("userUsageUser")}</th>
              <th scope="col">
                {weeks > 1
                  ? t("userUsageAllTime", { weeks })
                  : t("userUsageAllTimeWeek")}
              </th>
              <th scope="col">{t("userUsageLastWeek")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.username ?? ""}>
                <th scope="row" className={styles.usageUser}>
                  {user.username ?? t("usersSuperuser")}
                </th>
                <td>
                  <UsageCell totals={user.total} />
                </td>
                <td>
                  <UsageCell totals={user.lastWeek} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UsageCell({ totals }: { totals: UsageTotals }) {
  const { t } = useI18n();
  return (
    <ul className={styles.usageFacts}>
      <li>{formatActiveTime(totals.activeMs, t)}</li>
      <li>
        {t("userUsageSessions", {
          count: totals.sessions,
          suffix: totals.sessions === 1 ? "" : "s",
        })}
      </li>
      <li>
        {t("userUsageTurns", {
          count: totals.turns,
          suffix: totals.turns === 1 ? "" : "s",
        })}
      </li>
      <li>
        {t("userUsageWords", {
          count: totals.words.toLocaleString(),
          suffix: totals.words === 1 ? "" : "s",
        })}
      </li>
    </ul>
  );
}
