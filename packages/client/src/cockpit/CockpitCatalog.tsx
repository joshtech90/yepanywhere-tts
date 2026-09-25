import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { CockpitSessionRow } from "./CockpitSessionRow";
import { filterCockpitCatalog, type CockpitCatalogView } from "./core/catalog";
import { splitCockpitFavorites } from "./core/catalogSections";
import { createCockpitNavigation } from "./core/navigation";
import styles from "./CockpitCatalog.module.css";
import type { CockpitOrganizationController } from "./useCockpitOrganization";
import { useCockpitSessionMenu } from "./useCockpitSessionMenu";

export interface CockpitCatalogProps {
  basePath: string;
  catalog: CockpitCatalogView;
  error: Error | null;
  hasMore: boolean;
  loading: boolean;
  organization: CockpitOrganizationController;
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

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3Z" />
    </svg>
  );
}

export function CockpitCatalog({
  basePath,
  catalog,
  error,
  hasMore,
  loading,
  organization,
  query,
  onLoadMore,
  onQueryChange,
}: CockpitCatalogProps) {
  const { t } = useI18n();
  const navigation = createCockpitNavigation(basePath);
  const menu = useCockpitSessionMenu(organization);
  const visibleCatalog = useMemo(
    () => filterCockpitCatalog(catalog, query),
    [catalog, query],
  );
  const sections = useMemo(
    () => splitCockpitFavorites(visibleCatalog),
    [visibleCatalog],
  );
  const isEmpty =
    sections.favorites.length === 0 && sections.projects.length === 0;
  const sessionHref = (projectId: string | null, sessionId: string) =>
    projectId ? navigation.session(projectId, sessionId) : navigation.sessions;

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

      {organization.pinError && (
        <p className={styles.catalogError} role="status">
          {t("cockpitPinUnavailable")}
        </p>
      )}
      {error && (
        <p className={styles.catalogError} role="status">
          {t("cockpitCatalogError")}
        </p>
      )}

      <div className={styles.projectList}>
        {isEmpty && !loading && (
          <p className={styles.emptyMessage}>
            {query ? t("cockpitCatalogNoMatches") : t("cockpitCatalogEmpty")}
          </p>
        )}

        {sections.favorites.length > 0 && (
          <section
            aria-labelledby="cockpit-favorites-title"
            className={styles.favorites}
          >
            <h2 className={styles.sectionTitle} id="cockpit-favorites-title">
              <StarIcon />
              {t("cockpitFavoritesTitle")}
            </h2>
            <ul className={styles.sessionList}>
              {sections.favorites.map(({ session, projectName }) => (
                <li key={session.key}>
                  <CockpitSessionRow
                    href={sessionHref(session.projectId, session.id)}
                    onOpenMenu={menu.open}
                    projectName={projectName || undefined}
                    session={session}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {sections.projects.map((project) => (
          <section className={styles.projectGroup} key={project.key}>
            <header className={styles.projectHeader}>
              <h2 className={styles.projectTitle}>
                {project.id ? (
                  <Link
                    aria-label={t("cockpitProjectLink", {
                      name: project.name || t("cockpitUnknownProject"),
                    })}
                    to={navigation.project(project.id)}
                  >
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
                {project.sessions.map((session) => (
                  <li key={session.key}>
                    <CockpitSessionRow
                      href={sessionHref(session.projectId, session.id)}
                      onOpenMenu={menu.open}
                      session={session}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {hasMore && (
        <div className={styles.coverage}>
          <p>
            {t(
              catalog.sessionCount === 1
                ? "cockpitCatalogCoverageOne"
                : "cockpitCatalogCoverage",
              { count: catalog.sessionCount },
            )}
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
      {menu.element}
    </section>
  );
}
