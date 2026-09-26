import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link } from "react-router-dom";
import { getSessionDisplayTitle } from "../utils";
import type { SearchField } from "../components/session-search/model";
import { useI18n } from "../i18n";
import { createCockpitNavigation } from "./core/navigation";
import styles from "./CockpitSearchPanel.module.css";
import { useCockpitSearch } from "./useCockpitSearch";

export interface CockpitSearchPanelProps {
  basePath: string;
  focusOnOpen?: boolean;
  onClose: () => void;
  onNavigate: () => void;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function toggleField(fields: SearchField[], field: SearchField): SearchField[] {
  if (!fields.includes(field)) return [...fields, field];
  const next = fields.filter((candidate) => candidate !== field);
  return next.length > 0 ? next : ["title"];
}

export function CockpitSearchPanel({
  basePath,
  focusOnOpen = false,
  onClose,
  onNavigate,
}: CockpitSearchPanelProps) {
  const { t } = useI18n();
  const navigation = createCockpitNavigation(basePath);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [fields, setFields] = useState<SearchField[]>(["title"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultLinkRefs = useRef(new Map<string, HTMLAnchorElement>());
  const search = useCockpitSearch(query, fields);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const contentFieldsDisabled = search.support === "title-only";
  const busy =
    search.catalogLoading ||
    (search.catalogHasMore && !search.error) ||
    search.contentRunning;

  useEffect(() => {
    if (search.support === "title-only") {
      setFields(["title"]);
    }
  }, [search.support]);

  useEffect(() => {
    if (focusOnOpen || matchMedia("(min-width: 701px)").matches) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [focusOnOpen]);

  useEffect(() => {
    if (
      selectedSessionId &&
      search.results.some(
        (result) => result.session.id === selectedSessionId,
      )
    ) {
      return;
    }
    setSelectedSessionId(search.results[0]?.session.id);
  }, [search.results, selectedSessionId]);

  const coverage = useMemo(() => {
    const singular = search.loadedSessionCount === 1;
    if (search.error) {
      return t(
        singular
          ? "cockpitGlobalSearchCoverageErrorOne"
          : "cockpitGlobalSearchCoverageError",
        {
          count: search.loadedSessionCount,
        },
      );
    }
    if (search.catalogHasMore || search.catalogLoading) {
      return t(
        singular
          ? "cockpitGlobalSearchCoverageLoadingOne"
          : "cockpitGlobalSearchCoverageLoading",
        {
          count: search.loadedSessionCount,
        },
      );
    }
    return t(
      singular
        ? "cockpitGlobalSearchCoverageCompleteOne"
        : "cockpitGlobalSearchCoverageComplete",
      {
        count: search.loadedSessionCount,
      },
    );
  }, [
    search.catalogHasMore,
    search.catalogLoading,
    search.error,
    search.loadedSessionCount,
    t,
  ]);

  const editQuery = (value: string) => {
    setDraft(value);
    startTransition(() => setQuery(value));
  };

  const focusResult = (index: number) => {
    const result = search.results[index];
    if (!result) return;
    setSelectedSessionId(result.session.id);
    resultLinkRefs.current.get(result.session.id)?.focus();
  };
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowDown" || search.results.length === 0) {
      return;
    }
    event.preventDefault();
    const selectedIndex = search.results.findIndex(
      (result) => result.session.id === selectedSessionId,
    );
    focusResult(selectedIndex >= 0 ? selectedIndex : 0);
  };
  const handleResultKeyDown = (
    event: KeyboardEvent<HTMLAnchorElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusResult(Math.min(index + 1, search.results.length - 1));
      return;
    }
    if (event.key !== "ArrowUp") return;
    event.preventDefault();
    if (index === 0) {
      inputRef.current?.focus();
      return;
    }
    focusResult(index - 1);
  };

  return (
    <section className={styles.root} aria-labelledby="cockpit-search-title">
      <header className={styles.header}>
        <div>
          <p>{t("cockpitGlobalSearchEyebrow")}</p>
          <h1 id="cockpit-search-title">{t("cockpitGlobalSearchTitle")}</h1>
        </div>
        <button
          aria-label={t("cockpitGlobalSearchClose")}
          className={styles.close}
          onClick={onClose}
          type="button"
        >
          <CloseIcon />
        </button>
      </header>

      <div className={styles.searchBox}>
        <label className={styles.searchField}>
          <SearchIcon />
          <span className={styles.srOnly}>
            {t("cockpitGlobalSearchInputLabel")}
          </span>
          <input
            aria-label={t("cockpitGlobalSearchInputLabel")}
            onChange={(event) => editQuery(event.currentTarget.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t("cockpitGlobalSearchPlaceholder")}
            ref={inputRef}
            type="search"
            value={draft}
          />
          {draft && (
            <button
              aria-label={t("cockpitGlobalSearchClear")}
              onClick={() => editQuery("")}
              type="button"
            >
              ×
            </button>
          )}
        </label>

        <fieldset className={styles.fields}>
          <legend>{t("cockpitGlobalSearchIn")}</legend>
          {(
            [
              ["title", t("cockpitGlobalSearchFieldTitle")],
              ["user", t("cockpitGlobalSearchFieldUser")],
              ["assistant", t("cockpitGlobalSearchFieldAssistant")],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              <input
                checked={fields.includes(field)}
                disabled={field !== "title" && contentFieldsDisabled}
                onChange={() =>
                  setFields((current) => toggleField(current, field))
                }
                type="checkbox"
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div className={styles.coverage} aria-live="polite">
          <span>{coverage}</span>
          {search.support === "checking" && (
            <span>{t("cockpitGlobalSearchCheckingSupport")}</span>
          )}
          {search.support === "title-only" && (
            <span>{t("cockpitGlobalSearchTitleOnly")}</span>
          )}
          {busy && <span>{t("cockpitGlobalSearchUpdating")}</span>}
        </div>
      </div>

      {search.error && (
        <p className={styles.error} role="status">
          {t("cockpitGlobalSearchError")}
        </p>
      )}

      {search.unsupportedProviderSessionCount > 0 && (
        <p className={styles.notice}>
          {t(
            search.unsupportedProviderSessionCount === 1
              ? "cockpitGlobalSearchUnsupportedProvidersOne"
              : "cockpitGlobalSearchUnsupportedProviders",
            { count: search.unsupportedProviderSessionCount },
          )}
        </p>
      )}

      {search.partialSessions.length > 0 && (
        <details className={styles.partial}>
          <summary>
            {t(
              search.partialSessions.length === 1
                ? "cockpitGlobalSearchPartialOne"
                : "cockpitGlobalSearchPartial",
              { count: search.partialSessions.length },
            )}
          </summary>
          <p>{t("cockpitGlobalSearchPartialBody")}</p>
          <ul>
            {search.partialSessions.map(({ session, reason }) => (
              <li key={session.id}>
                <Link
                  onClick={onNavigate}
                  to={navigation.session(session.projectId, session.id)}
                >
                  {getSessionDisplayTitle(session) ??
                    t("cockpitSessionTitleFallback")}
                </Link>
                <span>: {reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={styles.resultSummary} aria-live="polite">
        {query.trim()
          ? t(
              search.results.length === 1
                ? "cockpitGlobalSearchResultCountOne"
                : "cockpitGlobalSearchResultCount",
              { count: search.results.length },
            )
          : t("cockpitGlobalSearchHint")}
      </div>

      <div className={styles.results} aria-busy={busy}>
        {query.trim() && search.results.length === 0 && !busy && (
          <div className={styles.empty}>
            <h2>{t("cockpitGlobalSearchNoResults")}</h2>
            <p>{t("cockpitGlobalSearchNoResultsBody")}</p>
          </div>
        )}

        {search.results.map((result, index) => {
          const session = result.session;
          const title =
            getSessionDisplayTitle(session) ??
            t("cockpitSessionTitleFallback");
          const turnMatches = result.matches.filter(
            (match) => match.role !== "title",
          );
          const shownMatches = turnMatches.slice(0, 3);
          const hiddenCount = turnMatches.length - shownMatches.length;
          return (
            <article
              className={styles.result}
              data-selected={
                selectedSessionId === session.id ? "true" : "false"
              }
              key={session.id}
            >
              <Link
                aria-label={title}
                aria-current={
                  selectedSessionId === session.id ? "true" : undefined
                }
                className={styles.resultLink}
                onClick={onNavigate}
                onFocus={() => setSelectedSessionId(session.id)}
                onKeyDown={(event) => handleResultKeyDown(event, index)}
                ref={(node) => {
                  if (node) resultLinkRefs.current.set(session.id, node);
                  else resultLinkRefs.current.delete(session.id);
                }}
                to={navigation.session(session.projectId, session.id)}
              >
                <span className={styles.resultHeading}>
                  <span>
                    <strong>{title}</strong>
                    <small>{session.projectName}</small>
                  </span>
                  <span className={styles.provider}>{session.provider}</span>
                </span>
                {result.titleMatched && (
                  <span className={styles.titleMatch}>
                    {t("cockpitGlobalSearchTitleMatch")}
                  </span>
                )}
                {shownMatches.map((match) => (
                  <span className={styles.preview} key={match.id}>
                    <span data-role={match.role}>
                      {match.role === "user"
                        ? t("cockpitGlobalSearchUserMatch")
                        : t("cockpitGlobalSearchAssistantMatch")}
                    </span>
                    <span>{match.preview}</span>
                  </span>
                ))}
                {hiddenCount > 0 && (
                  <span className={styles.moreMatches}>
                    {t("cockpitGlobalSearchMoreMatches", {
                      count: hiddenCount,
                    })}
                  </span>
                )}
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
