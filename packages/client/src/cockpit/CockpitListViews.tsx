import { projectDisplayName } from "@yep-anywhere/shared";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useGlobalSessionsFeed } from "../hooks/useGlobalSessionsFeed";
import { useProjects } from "../hooks/useProjects";
import { useI18n } from "../i18n";
import {
  useClientSummaryState,
  useSessionCollectionQueryRecords,
} from "../lib/clientSummaryStore";
import { CockpitSessionRow } from "./CockpitSessionRow";
import { CockpitStatusLed } from "./CockpitStatusLed";
import { formatCockpitActivityTime } from "./core/activityTime";
import { createCockpitCatalog, filterCockpitCatalog } from "./core/catalog";
import { flattenCockpitCatalog } from "./core/catalogSections";
import { createCockpitNavigation } from "./core/navigation";
import type { CockpitShellState } from "./core/shellState";
import styles from "./CockpitListViews.module.css";
import type { CockpitOrganizationController } from "./useCockpitOrganization";
import { useCockpitSessionMenu } from "./useCockpitSessionMenu";

function FilterField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      aria-label={label}
      className={styles.filter}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={label}
      type="search"
      value={value}
    />
  );
}

export interface CockpitSessionsViewProps {
  basePath: string;
  organization: CockpitOrganizationController;
  projectId: string | null;
  shellKind: CockpitShellState["kind"];
}

/**
 * All sessions, or the sessions of one project, as a Cockpit page. It mounts
 * the existing global-sessions feed only while it is open, like the search.
 */
export function CockpitSessionsView({
  basePath,
  organization,
  projectId,
  shellKind,
}: CockpitSessionsViewProps) {
  const { t } = useI18n();
  const runtime = useCurrentSourceRuntime();
  const navigation = createCockpitNavigation(basePath);
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const projectsFeed = useProjects();
  const sessionsFeed = useGlobalSessionsFeed({
    limit: 100,
    projectId,
    includeStats: false,
  });
  const records = useSessionCollectionQueryRecords(sessionsFeed.query);
  const summaryState = useClientSummaryState();
  const menu = useCockpitSessionMenu(organization);
  const catalog = useMemo(
    () =>
      createCockpitCatalog({
        sourceKey: runtime.sourceKey,
        projects: projectsFeed.projects,
        sessions: records,
        providerRuntimeBySessionId: summaryState.providerRuntime.bySessionId,
        connection:
          shellKind === "offline"
            ? "offline"
            : shellKind === "error"
              ? "error"
              : "online",
      }),
    [
      projectsFeed.projects,
      records,
      runtime.sourceKey,
      shellKind,
      summaryState.providerRuntime.bySessionId,
    ],
  );
  const rows = useMemo(
    () => flattenCockpitCatalog(filterCockpitCatalog(catalog, deferredFilter)),
    [catalog, deferredFilter],
  );
  const project = projectId
    ? projectsFeed.projects.find((item) => item.id === projectId)
    : undefined;
  const heading = project
    ? projectDisplayName(project)
    : t("cockpitSessionsViewTitle");

  return (
    <section className={styles.root} aria-labelledby="cockpit-list-title">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          {projectId && (
            <Link className={styles.crumb} to={navigation.projects}>
              {t("sidebarProjects")}
            </Link>
          )}
          <h2 id="cockpit-list-title">{heading}</h2>
          {project && <p className={styles.path}>{project.path}</p>}
        </div>
        <div className={styles.headerActions}>
          <FilterField
            label={t("cockpitListFilter")}
            onChange={setFilter}
            value={filter}
          />
          <Link
            className={styles.primaryAction}
            to={
              projectId
                ? navigation.newSessionIn(projectId)
                : navigation.newSession
            }
          >
            {t("sidebarNewSession")}
          </Link>
        </div>
      </header>

      {sessionsFeed.error && (
        <p className={styles.notice} role="status">
          {t("cockpitCatalogError")}
        </p>
      )}
      {rows.length === 0 && !sessionsFeed.loading && (
        <p className={styles.empty}>
          {deferredFilter
            ? t("cockpitCatalogNoMatches")
            : t("cockpitCatalogEmpty")}
        </p>
      )}
      <ul className={styles.list}>
        {rows.map(({ session, projectName }) => (
          <li key={session.key}>
            <CockpitSessionRow
              href={
                session.projectId
                  ? navigation.session(session.projectId, session.id)
                  : navigation.sessions
              }
              onOpenMenu={menu.open}
              projectName={projectId ? undefined : projectName}
              session={session}
            />
          </li>
        ))}
      </ul>
      {(sessionsFeed.hasMore || sessionsFeed.loading) && (
        <div className={styles.more}>
          <button
            disabled={sessionsFeed.loading}
            onClick={() => void sessionsFeed.loadMore()}
            type="button"
          >
            {sessionsFeed.loading
              ? t("cockpitCatalogLoading")
              : t("cockpitCatalogLoadMore")}
          </button>
        </div>
      )}
      {menu.element}
    </section>
  );
}

export interface CockpitProjectsViewProps {
  basePath: string;
}

/** Projects with their session counts; a project opens its session list. */
export function CockpitProjectsView({ basePath }: CockpitProjectsViewProps) {
  const { locale, t } = useI18n();
  const navigation = createCockpitNavigation(basePath);
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const { projects, loading, error } = useProjects();
  const rows = useMemo(() => {
    const needle = deferredFilter.trim().toLocaleLowerCase();
    return projects
      .map((project) => ({ project, name: projectDisplayName(project) }))
      .filter(
        ({ project, name }) =>
          !needle ||
          name.toLocaleLowerCase().includes(needle) ||
          project.path.toLocaleLowerCase().includes(needle),
      )
      .sort(
        (left, right) =>
          (Date.parse(right.project.lastActivity ?? "") || 0) -
            (Date.parse(left.project.lastActivity ?? "") || 0) ||
          left.name.localeCompare(right.name),
      );
  }, [deferredFilter, projects]);

  return (
    <section className={styles.root} aria-labelledby="cockpit-list-title">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <h2 id="cockpit-list-title">{t("sidebarProjects")}</h2>
        </div>
        <div className={styles.headerActions}>
          <FilterField
            label={t("cockpitListFilter")}
            onChange={setFilter}
            value={filter}
          />
        </div>
      </header>
      {error && (
        <p className={styles.notice} role="status">
          {t("cockpitCatalogError")}
        </p>
      )}
      {rows.length === 0 && !loading && (
        <p className={styles.empty}>
          {deferredFilter
            ? t("cockpitCatalogNoMatches")
            : t("cockpitCatalogEmpty")}
        </p>
      )}
      <ul className={styles.list}>
        {rows.map(({ project, name }) => {
          const active = project.activeOwnedCount + project.activeExternalCount;
          const time = formatCockpitActivityTime(
            project.lastActivity ?? undefined,
            locale,
          );
          return (
            <li className={styles.projectRow} key={project.id}>
              <Link
                className={styles.projectLink}
                to={navigation.project(project.id)}
              >
                <span className={styles.projectTitle}>
                  <CockpitStatusLed
                    label={
                      active > 0
                        ? t("cockpitSessionStatusActive")
                        : t("cockpitSessionStatusComplete")
                    }
                    tone={active > 0 ? "working" : "idle"}
                  />
                  <strong>{name}</strong>
                </span>
                <span className={styles.projectMeta}>
                  {time && (
                    <time
                      dateTime={project.lastActivity ?? undefined}
                      title={time.title}
                    >
                      {time.label}
                    </time>
                  )}
                  <span>
                    {t(
                      project.sessionCount === 1
                        ? "cockpitSessionsCountOne"
                        : "cockpitSessionsCount",
                      { count: project.sessionCount },
                    )}
                  </span>
                  <span className={styles.path}>{project.path}</span>
                </span>
              </Link>
              <Link
                aria-label={t("cockpitNewSessionInProject", { name })}
                className={styles.iconAction}
                title={t("cockpitNewSessionInProject", { name })}
                to={navigation.newSessionIn(project.id)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
