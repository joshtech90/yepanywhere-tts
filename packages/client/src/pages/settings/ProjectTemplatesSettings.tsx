import { useEffect, useState } from "react";
import {
  DEFAULT_PROJECT_TEMPLATE_SOURCE,
  DEFAULT_PROJECT_TEMPLATE_SOURCES,
  SERVER_CAPABILITIES,
  serverHasCapability,
  type ProjectTemplateSourceState,
  type ProjectTemplateSourcesConfig,
} from "@yep-anywhere/shared";
import { fetchJSON } from "../../api/sourceApiFetch";
import { useVersion } from "../../hooks/useVersion";
import { useActingPrincipal } from "../../hooks/useActingPrincipal";
import { useI18n } from "../../i18n";
import { SettingsSection } from "./SettingsSection";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import styles from "./ProjectTemplatesSettings.module.css";

function editConfig(config: ProjectTemplateSourcesConfig) {
  return {
    ...config,
    sources: config.sources.map((source) => ({
      ...source,
      location:
        source.repository +
        (source.contentPath ? `/${source.contentPath}` : ""),
    })),
  };
}

function isLocalLocation(location: string) {
  return /^(?:\/|~\/|[A-Za-z]:[\\/])/.test(location);
}

function sourceConfig(
  source: ReturnType<typeof editConfig>["sources"][number],
) {
  const { location, ...config } = source;
  const value = location
    .trim()
    .replace(/^github\.com\//, "https://github.com/");
  const github = /^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(.*))?$/.exec(
    value,
  );
  return {
    ...config,
    repository: github?.[1] ?? value,
    contentPath: github?.[2] ?? "",
    revision: isLocalLocation(value) ? "HEAD" : config.revision,
  };
}

export function ProjectTemplatesSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("settingsProjectTemplatesTitle"));
  const { version } = useVersion();
  const { principal, resolved } = useActingPrincipal();
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectTemplateSources.name,
  );
  const allowed =
    supported && resolved && principal.superuser && !principal.switched;
  const [state, setState] = useState<ProjectTemplateSourceState | null>(null);
  const [draft, setDraft] = useState(() =>
    editConfig(DEFAULT_PROJECT_TEMPLATE_SOURCES),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void fetchJSON<ProjectTemplateSourceState>("/project-template-source")
      .then((value) => {
        if (active) {
          setState(value);
          setDraft(editConfig(value.config));
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed || state?.phase !== "fetching") return;
    let active = true;
    const timer = setTimeout(() => {
      void fetchJSON<ProjectTemplateSourceState>("/project-template-source")
        .then((value) => {
          if (active) setState(value);
        })
        .catch((cause: Error) => {
          if (active) {
            setError(cause.message);
            setState((previous) =>
              previous ? { ...previous, phase: "error" } : null,
            );
          }
        });
    }, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [allowed, state]);

  const save = async (defaultTip?: string) => {
    setSaving(true);
    setError(null);
    const edited = defaultTip
      ? {
          ...draft,
          enabled: true,
          sources: draft.sources.map((source) =>
            source.id === defaultTip ? { ...source, revision: "HEAD" } : source,
          ),
        }
      : draft;
    if (defaultTip) setDraft(edited);
    const config = {
      enabled: edited.enabled,
      sources: edited.sources.map(sourceConfig),
    };
    try {
      const value = await fetchJSON<ProjectTemplateSourceState>(
        "/project-template-source",
        { method: "PUT", body: JSON.stringify(config) },
      );
      setState(value);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) return null;
  const busy = saving || state?.phase === "fetching";
  return (
    <SettingsSection
      title={t("settingsProjectTemplatesTitle")}
      description={t("settingsProjectTemplatesDescription")}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className={styles.enabled}>
          <input
            type="checkbox"
            disabled={!state}
            checked={draft.enabled}
            onChange={(event) =>
              setDraft({ ...draft, enabled: event.target.checked })
            }
          />
          {t("templatesEnable")}
        </label>
        <p>{t("templatesLayerHelp")}</p>
        {draft.sources.map((source, index) => (
          <fieldset className={styles.source} key={source.id} disabled={!state}>
            <legend>
              {source.location
                ? source.location.replace("https://github.com/", "")
                : t("templatesNewSource")}
            </legend>
            {(isLocalLocation(source.location)
              ? (["location"] as const)
              : (["location", "revision"] as const)
            ).map((field) => (
              <label className={styles.field} key={field}>
                {t(
                  field === "location"
                    ? "templatesRepository"
                    : "templatesRevision",
                )}
                <input
                  className="settings-input"
                  value={source[field]}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      sources: previous.sources.map((entry) =>
                        entry.id === source.id
                          ? { ...entry, [field]: event.target.value }
                          : entry,
                      ),
                    }))
                  }
                />
              </label>
            ))}
            <div className={styles.actions}>
              <button
                className="settings-button"
                type="button"
                disabled={index === 0 || busy}
                onClick={() =>
                  setDraft((previous) => {
                    const sources = [...previous.sources];
                    const earlier = sources[index - 1];
                    if (!earlier) return previous;
                    sources[index - 1] = source;
                    sources[index] = earlier;
                    return { ...previous, sources };
                  })
                }
              >
                {t("templatesMoveUp")}
              </button>
              <button
                className="settings-button"
                type="button"
                disabled={draft.sources.length === 1 || busy}
                onClick={() =>
                  setDraft((previous) => ({
                    ...previous,
                    sources: previous.sources.filter(
                      (entry) => entry.id !== source.id,
                    ),
                  }))
                }
              >
                {t("templatesRemoveSource")}
              </button>
              {draft.enabled && !isLocalLocation(source.location) && (
                <button
                  className="settings-button"
                  type="button"
                  disabled={busy || !state}
                  onClick={() => void save(source.id)}
                >
                  {t("templatesUpdateHead")}
                </button>
              )}
            </div>
          </fieldset>
        ))}
        <button
          className="settings-button"
          type="button"
          disabled={!state || busy || draft.sources.length >= 20}
          onClick={() =>
            setDraft((previous) => ({
              ...previous,
              sources: [
                ...previous.sources,
                {
                  ...DEFAULT_PROJECT_TEMPLATE_SOURCE,
                  id: `source-${crypto.randomUUID()}`,
                  repository: "",
                  contentPath: "",
                  location: "",
                },
              ],
            }))
          }
        >
          {t("templatesAddSource")}
        </button>
        <p>{t("templatesFetchHelp")}</p>
        <div className={styles.actions}>
          <button
            className="settings-button"
            type="submit"
            disabled={busy || !state}
          >
            {draft.enabled ? t("templatesFetch") : t("templatesSave")}
          </button>
        </div>
      </form>
      <div className={styles.status} role="status">
        {state?.phase === "fetching" && t("templatesFetching")}
        {state?.phase === "disabled" && t("templatesDisabled")}
        {state?.phase === "ready" && (
          <p>
            {state.result === "up-to-date"
              ? t("templatesUpToDate")
              : t("templatesFetched")}
          </p>
        )}
        {state?.snapshot && (
          <>
            {state.snapshot.sources.map((source) => (
              <div key={source.id}>
                <p>
                  {source.repository.replace("https://github.com/", "")}
                  {source.commit && (
                    <>
                      {" — "}
                      {t(
                        source.local ? "templatesLocalHead" : "templatesCommit",
                      )}{" "}
                      <code>{source.commit}</code>
                    </>
                  )}
                </p>
                <p>
                  {source.local
                    ? t("templatesLocalDirect")
                    : t("templatesRewritten", { count: source.rewrittenFiles })}
                </p>
              </div>
            ))}
            <ul>
              {state.snapshot.templates.map((template) => (
                <li key={template.id}>
                  <strong>{template.title}</strong> —{" "}
                  {state.snapshot?.sources
                    .find((source) => source.id === template.sourceId)
                    ?.repository.replace("https://github.com/", "")}{" "}
                  — {template.description} (
                  {template.status === "draft"
                    ? t("templatesDraft")
                    : t("templatesReady")}
                  )
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
    </SettingsSection>
  );
}
