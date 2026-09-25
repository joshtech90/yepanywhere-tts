import type { ProviderName } from "@yep-anywhere/shared";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useModelSettings } from "../hooks/useModelSettings";
import { useProjects } from "../hooks/useProjects";
import { useProviders } from "../hooks/useProviders";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import { createSessionNavigationState } from "../lib/sessionNavigationState";
import styles from "./CockpitNewSession.module.css";
import {
  CockpitModelField,
  CockpitPermissionField,
  CockpitThinkingField,
} from "./CockpitRunSettings";
import { createCockpitNavigation } from "./core/navigation";
import {
  initialLaunchSelection,
  launchableProviders,
  launchChoices,
  launchOptions,
  normalizeProjectPath,
  rememberLaunch,
  selectionForProvider,
  type CockpitLaunchSelection,
} from "./core/newSession";

const OTHER_FOLDER = "\0other";

/** Home prefixes shortened so the folder list stays readable on a phone. */
function shortPath(path: string): string {
  return path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}

export interface CockpitNewSessionProps {
  basePath: string;
  /** Project preselected from the link, e.g. "new session in this project". */
  projectId?: string | null;
}

export function CockpitNewSession({
  basePath,
  projectId,
}: CockpitNewSessionProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const navigation = useMemo(
    () => createCockpitNavigation(basePath),
    [basePath],
  );
  const { projects } = useProjects();
  const { providers, loading: providersLoading } = useProviders();
  const { settings, updateSetting } = useServerSettings();
  const { thinkingMode, effortLevel } = useModelSettings();
  const legacy = useMemo(
    () => ({ thinkingMode, effortLevel }),
    [effortLevel, thinkingMode],
  );
  const defaults = settings?.newSessionDefaults;
  const launchable = useMemo(() => launchableProviders(providers), [providers]);
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((left, right) =>
        (right.lastActivity ?? "").localeCompare(left.lastActivity ?? ""),
      ),
    [projects],
  );

  const [selection, setSelection] = useState<CockpitLaunchSelection | null>(
    null,
  );
  const [projectChoice, setProjectChoice] = useState<string | null>(
    projectId ?? null,
  );
  const [folder, setFolder] = useState("");
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  // A start that finishes after this view was left must not navigate back;
  // the session still runs and shows up in the list.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const folderRef = useRef<HTMLInputElement>(null);
  const projectFieldId = useId();
  const folderFieldId = useId();
  const messageFieldId = useId();

  // Seed once providers and saved defaults are known; later provider refreshes
  // must not overwrite what Joscha already picked.
  useEffect(() => {
    if (selection || settings === null || launchable.length === 0) return;
    setSelection(initialLaunchSelection(defaults, launchable, legacy));
  }, [defaults, launchable, legacy, selection, settings]);

  useEffect(() => {
    if (projectChoice !== null) return;
    const recent = sortedProjects[0];
    if (recent) setProjectChoice(recent.id);
  }, [projectChoice, sortedProjects]);

  // Desktop starts typing at once; on a phone the keyboard would cover the
  // settings, so focus waits for a tap there.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    messageRef.current?.focus({ preventScroll: true });
  }, []);

  const providerInfo = launchable.find(
    (provider) => provider.name === selection?.provider,
  );
  const choices = selection
    ? launchChoices(selection, providerInfo, t)
    : null;
  const customFolder = projectChoice === OTHER_FOLDER;
  const folderPath = normalizeProjectPath(folder);
  const canStart =
    choices !== null &&
    !starting &&
    message.trim().length > 0 &&
    (customFolder ? folderPath.length > 0 : projectChoice !== null);

  const update = (patch: Partial<CockpitLaunchSelection>) =>
    setSelection((current) => (current ? { ...current, ...patch } : current));

  const chooseProvider = (name: ProviderName) => {
    const next = launchable.find((provider) => provider.name === name);
    if (!next || !selection) return;
    setSelection(
      selectionForProvider(defaults, next, legacy, selection.permissionMode),
    );
  };

  const start = async () => {
    if (!canStart || !choices) return;
    setStarting(true);
    setError(null);
    try {
      let targetProjectId = projectChoice;
      if (customFolder) {
        const added = await api.addProject(folderPath);
        targetProjectId = added.project.id;
      }
      if (!targetProjectId) throw new Error(t("newSessionProjectNotFound"));
      const text = message.trim();
      const result = await api.startSession(
        targetProjectId,
        text,
        launchOptions(choices),
        undefined,
        Date.now(),
      );
      const remembered = rememberLaunch(defaults, choices.effective, legacy);
      if (remembered) {
        void updateSetting("newSessionDefaults", remembered).catch(() => {});
      }
      if (!mountedRef.current) return;
      navigate(navigation.session(result.projectId, result.sessionId), {
        state: createSessionNavigationState({
          initialStatus: {
            owner: "self",
            processId: result.processId,
            permissionMode: result.permissionMode,
            appliedPermissionMode: result.appliedPermissionMode,
            modeVersion: result.modeVersion,
            recapAfterSeconds: result.recapAfterSeconds,
          },
          initialTitle: text,
          initialModel: result.model ?? choices.effective.model ?? undefined,
          initialProvider: result.provider ?? choices.effective.provider ?? undefined,
        }),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("newSessionStartError"),
      );
      setStarting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void start();
  };

  const onMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
      return;
    // On touch keyboards Enter stays a line break; the button starts.
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    event.preventDefault();
    void start();
  };

  return (
    <form
      aria-labelledby="cockpit-new-session-title"
      className={styles.root}
      onSubmit={submit}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t("cockpitNewSessionEyebrow")}</p>
        <h2 id="cockpit-new-session-title">{t("sidebarNewSession")}</h2>
      </header>

      <section className={styles.card}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={projectFieldId}>
            {t("newSessionProjectPathLabel")}
          </label>
          <select
            className={styles.select}
            id={projectFieldId}
            onChange={(event) => {
              setProjectChoice(event.target.value);
              if (event.target.value === OTHER_FOLDER) {
                requestAnimationFrame(() => folderRef.current?.focus());
              }
            }}
            value={projectChoice ?? ""}
          >
            {projectChoice === null && <option value="" />}
            {sortedProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {`${project.name} · ${shortPath(project.path)}`}
              </option>
            ))}
            <option value={OTHER_FOLDER}>{t("cockpitNewSessionOtherFolder")}</option>
          </select>
          {customFolder && (
            <>
              <label className={styles.srOnly} htmlFor={folderFieldId}>
                {t("newSessionProjectPathLabel")}
              </label>
              <input
                autoCapitalize="off"
                autoCorrect="off"
                className={styles.input}
                id={folderFieldId}
                onChange={(event) => setFolder(event.target.value)}
                placeholder="~/Projects/…"
                ref={folderRef}
                spellCheck={false}
                value={folder}
              />
            </>
          )}
        </div>

        {launchable.length > 1 && selection && (
          <div className={styles.field}>
            <span className={styles.label}>{t("newSessionProviderTitle")}</span>
            <div
              aria-label={t("newSessionProviderTitle")}
              className={styles.providers}
              role="radiogroup"
            >
              {launchable.map((provider) => (
                <button
                  aria-checked={provider.name === selection.provider}
                  className={styles.provider}
                  key={provider.name}
                  onClick={() => chooseProvider(provider.name)}
                  role="radio"
                  title={
                    provider.authenticated
                      ? undefined
                      : t("newSessionProviderStatusNotAuthenticated")
                  }
                  type="button"
                >
                  {provider.displayName}
                </button>
              ))}
            </div>
          </div>
        )}

        {choices ? (
          <>
            <CockpitModelField
              models={choices.models}
              onChange={(model) => update({ model })}
              value={choices.effective.model}
            />
            {choices.supportsThinking && (
              <CockpitThinkingField
                effort={choices.effective.effortLevel}
                effortOptions={choices.effortOptions}
                mode={choices.effective.thinkingMode}
                modes={choices.thinkingModes}
                onEffortChange={(effortLevel) => update({ effortLevel })}
                onModeChange={(thinkingMode) => update({ thinkingMode })}
              />
            )}
            {choices.supportsPermissionMode && (
              <CockpitPermissionField
                modes={choices.permissionModes}
                onChange={(permissionMode) => update({ permissionMode })}
                value={choices.effective.permissionMode}
              />
            )}
          </>
        ) : (
          <p className={styles.loading} role="status">
            {providersLoading || settings === null
              ? t("cockpitLoadingTitle")
              : t("cockpitNewSessionNoProvider")}
          </p>
        )}
      </section>

      <section className={styles.card}>
        <label className={styles.label} htmlFor={messageFieldId}>
          {t("cockpitNewSessionMessageLabel")}
        </label>
        <textarea
          className={styles.message}
          id={messageFieldId}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onMessageKeyDown}
          placeholder={t("newSessionPlaceholder")}
          ref={messageRef}
          rows={5}
          value={message}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            className={styles.secondary}
            disabled={starting}
            onClick={() => navigate(-1)}
            type="button"
          >
            {t("cockpitNewSessionCancel")}
          </button>
          <button className={styles.primary} disabled={!canStart} type="submit">
            {starting ? t("cockpitNewSessionStarting") : t("newSessionStartAction")}
          </button>
        </div>
      </section>
    </form>
  );
}
