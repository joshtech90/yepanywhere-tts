import { type MouseEvent, memo } from "react";
import { Link } from "react-router-dom";
import { useI18n, type TranslationFn } from "../i18n";
import { CockpitStatusLed } from "./CockpitStatusLed";
import { formatCockpitActivityTime } from "./core/activityTime";
import type {
  CockpitCatalogSession,
  CockpitSessionStatus,
} from "./core/catalog";
import { cockpitLedToneForStatus } from "./core/statusLed";
import styles from "./CockpitSessionRow.module.css";
import { useCockpitLongPress } from "./useCockpitLongPress";

export interface CockpitSessionMenuAnchor {
  x: number;
  y: number;
}

export interface CockpitSessionRowProps {
  href: string;
  projectName?: string;
  session: CockpitCatalogSession;
  onOpenMenu: (
    session: CockpitCatalogSession,
    anchor: CockpitSessionMenuAnchor,
  ) => void;
}

export function cockpitSessionStatusLabel(
  status: CockpitSessionStatus,
  t: TranslationFn,
): string {
  switch (status) {
    case "active":
      return t("cockpitSessionStatusActive");
    case "external":
      return t("cockpitSessionStatusExternal");
    case "complete":
      return t("cockpitSessionStatusComplete");
    case "approval":
      return t("cockpitSessionStatusApproval");
    case "question":
      return t("cockpitSessionStatusQuestion");
    case "error":
      return t("cockpitSessionStatusError");
    case "offline":
      return t("cockpitSessionStatusOffline");
  }
}

/**
 * One session in a Cockpit list. Right click, the keyboard's context-menu key
 * and a long press on touch screens all open the same session menu.
 */
export const CockpitSessionRow = memo(function CockpitSessionRow({
  href,
  projectName,
  session,
  onOpenMenu,
}: CockpitSessionRowProps) {
  const { locale, t } = useI18n();
  const title = session.title || t("cockpitUntitledSession");
  const time = formatCockpitActivityTime(session.lastActivityAt, locale);
  const statusLabel = cockpitSessionStatusLabel(session.status, t);
  const longPress = useCockpitLongPress((point) => onOpenMenu(session, point));

  const handleContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    // A keyboard-invoked context menu reports no pointer position.
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenMenu(session, { x: rect.left + 12, y: rect.bottom });
      return;
    }
    onOpenMenu(session, { x: event.clientX, y: event.clientY });
  };

  return (
    <Link
      aria-label={`${title}, ${statusLabel}${time ? `, ${time.label}` : ""}${
        projectName ? `, ${projectName}` : ""
      }`}
      className={styles.row}
      data-with-project={projectName ? "true" : "false"}
      onContextMenu={handleContextMenu}
      to={href}
      {...longPress}
    >
      <CockpitStatusLed
        label={statusLabel}
        tone={cockpitLedToneForStatus(session.status)}
      />
      <span className={styles.title}>{title}</span>
      {time ? (
        <time
          aria-hidden="true"
          className={styles.time}
          dateTime={session.lastActivityAt}
          title={time.title}
        >
          {time.label}
        </time>
      ) : (
        <span aria-hidden="true" className={styles.time} />
      )}
      {projectName && (
        <span aria-hidden="true" className={styles.project} title={projectName}>
          {projectName}
        </span>
      )}
    </Link>
  );
});
