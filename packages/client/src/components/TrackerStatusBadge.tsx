import type { IssueItem } from "@yep-anywhere/shared";
import { useI18n } from "../i18n";
import styles from "./TrackerStatusBadge.module.css";

export const TRACKER_STATUS_LABELS = {
  open: "issuesStatus_open",
  draft: "issuesStatus_draft",
  merged: "issuesStatus_merged",
  closed: "issuesStatus_closed",
} as const;

const CLASSES = {
  open: styles.open,
  draft: styles.draft,
  merged: styles.merged,
  closed: styles.closed,
};

/** The tracker's reported state; nothing at all when the server sent none. */
export function TrackerStatusBadge({
  item,
  className,
}: {
  item: IssueItem;
  className?: string;
}) {
  const { t } = useI18n();
  const status = item.trackerStatus;
  // A state a later server adds is left out rather than shown unlabelled.
  const label = status && TRACKER_STATUS_LABELS[status.state];
  if (!status || !label) return null;
  return (
    <span
      title={[
        status.checkedAt,
        status.mergedAt
          ? t("issuesMergedOn", {
              date: new Date(status.mergedAt).toLocaleString(),
            })
          : "",
        status.mergeCommitSha
          ? t("issuesMergeCommit", { sha: status.mergeCommitSha })
          : "",
      ]
        .filter(Boolean)
        .join(" · ")}
      className={`${styles.badge} ${CLASSES[status.state]} ${className ?? ""}`}
    >
      {t(label)}
    </span>
  );
}
