import { useMemo } from "react";
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
    sections.favorites.length === 0 && sections.others.length === 0;
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

        {sections.others.length > 0 && (
          <ul
            aria-label={t("cockpitSessionsViewTitle")}
            className={styles.sessionList}
          >
            {sections.others.map(({ session, projectName }) => (
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
        )}
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
