import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n, type TranslationFn } from "../i18n";
import { createCockpitNavigation } from "./core/navigation";
import {
  filterCockpitCatalog,
  type CockpitCatalogView,
  type CockpitSessionStatus,
} from "./core/catalog";
import styles from "./CockpitCatalog.module.css";

export interface CockpitCatalogProps {
  basePath: string;
  catalog: CockpitCatalogView;
  error: Error | null;
  hasMore: boolean;
  loading: boolean;
  query: string;
  onLoadMore: () => Promise<void>;
  onQueryChange: (query: string) => void;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3Z" />
    </svg>
  );
}

function statusLabel(status: CockpitSessionStatus, t: TranslationFn): string {
  switch (status) {
    case "active":
      return t("cockpitSessionStatusActive");
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

function formatActivity(
  value: string | undefined,
  locale: string,
  t: TranslationFn,
): { label: string; title?: string } {
  if (!value) return { label: t("cockpitActivityUnknown") };
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return { label: t("cockpitActivityUnknown") };

  const elapsedSeconds = Math.round((parsed - Date.now()) / 1000);
  const absolute = new Date(parsed).toLocaleString(locale);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) {
    return { label: formatter.format(elapsedSeconds, "second"), title: absolute };
  }
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) {
    return { label: formatter.format(elapsedMinutes, "minute"), title: absolute };
  }
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) {
    return { label: formatter.format(elapsedHours, "hour"), title: absolute };
  }
  const elapsedDays = Math.round(elapsedHours / 24);
  if (Math.abs(elapsedDays) < 7) {
    return { label: formatter.format(elapsedDays, "day"), title: absolute };
  }
  return { label: new Date(parsed).toLocaleDateString(locale), title: absolute };
}

export function CockpitCatalog({
  basePath,
  catalog,
  error,
  hasMore,
  loading,
  query,
  onLoadMore,
  onQueryChange,
}: CockpitCatalogProps) {
  const { locale, t } = useI18n();
  const navigation = createCockpitNavigation(basePath);
  const visibleCatalog = useMemo(
    () => filterCockpitCatalog(catalog, query),
    [catalog, query],
  );
  const hasProjects = visibleCatalog.projects.length > 0;

  return (
    <section className={styles.root} aria-label={t("cockpitCatalogAria")}>
      <label className={styles.search}>
        <span className={styles.searchLabel}>{t("cockpitSearchLabel")}</span>
        <span className={styles.searchField}>
          <SearchIcon />
          <input
            aria-label={t("cockpitSearchLabel")}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder={t("cockpitSearchPlaceholder")}
            type="search"
            value={query}
          />
          {query && (
            <button
              aria-label={t("cockpitClearSearch")}
              onClick={() => onQueryChange("")}
              type="button"
            >
              ×
            </button>
          )}
        </span>
      </label>

      <div className={styles.summaryRow} aria-live="polite">
        <span>
          {t("cockpitSessionsCount", { count: visibleCatalog.sessionCount })}
        </span>
        {loading && <span>{t("cockpitCatalogLoading")}</span>}
      </div>

      {error && (
        <p className={styles.catalogError} role="status">
          {t("cockpitCatalogError")}
        </p>
      )}

      <div className={styles.projectList}>
        {!hasProjects && !loading && (
          <p className={styles.emptyMessage}>
            {query
              ? t("cockpitCatalogNoMatches")
              : t("cockpitCatalogEmpty")}
          </p>
        )}

        {visibleCatalog.projects.map((project) => (
          <section className={styles.projectGroup} key={project.key}>
            <header className={styles.projectHeader}>
              <h2 className={styles.projectTitle}>
                {project.id ? (
                  <Link to={navigation.project(project.id)}>
                    <span>{project.name || t("cockpitUnknownProject")}</span>
                    <small>{project.path}</small>
                  </Link>
                ) : (
                  <span className={styles.unknownProject}>
                    {project.name || t("cockpitUnknownProject")}
                  </span>
                )}
              </h2>
              <span className={styles.projectCount}>
                {project.sessions.length}
              </span>
            </header>

            {project.sessions.length === 0 ? (
              <p className={styles.projectEmpty}>
                {t("cockpitProjectNoSessions")}
              </p>
            ) : (
              <ul className={styles.sessionList}>
                {project.sessions.map((session) => {
                  const activity = formatActivity(
                    session.lastActivityAt,
                    locale,
                    t,
                  );
                  const title = session.title || t("cockpitUntitledSession");
                  const sessionHref = session.projectId
                    ? navigation.session(session.projectId, session.id)
                    : navigation.sessions;
                  return (
                    <li key={session.key}>
                      <Link className={styles.sessionLink} to={sessionHref}>
                        <span className={styles.sessionTitleRow}>
                          <span className={styles.sessionTitle}>{title}</span>
                          {session.pinned && (
                            <span
                              className={styles.pin}
                              title={t("cockpitPinnedSession")}
                            >
                              <PinIcon />
                              <span className={styles.srOnly}>
                                {t("cockpitPinnedSession")}
                              </span>
                            </span>
                          )}
                        </span>
                        <span className={styles.sessionMeta}>
                          <span
                            className={styles.status}
                            data-status={session.status}
                          >
                            <span aria-hidden="true" />
                            {statusLabel(session.status, t)}
                          </span>
                          <time
                            aria-label={t("cockpitLastActivity", {
                              time: activity.label,
                            })}
                            dateTime={session.lastActivityAt}
                            title={activity.title}
                          >
                            {activity.label}
                          </time>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      {hasMore && (
        <div className={styles.coverage}>
          <p>
            {t("cockpitCatalogCoverage", { count: catalog.sessionCount })}
          </p>
          <button
            disabled={loading}
            onClick={() => void onLoadMore()}
            type="button"
          >
            {t("cockpitCatalogLoadMore")}
          </button>
        </div>
      )}
    </section>
  );
}
