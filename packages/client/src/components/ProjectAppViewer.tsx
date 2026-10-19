import {
  ARTIFACT_SANDBOX,
  SERVER_CAPABILITIES,
  serverHasCapability,
  type ProjectAppInfo,
  type ProjectAppView,
  type ProjectAppAddresses,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { projectAppApi, type ProjectAppTarget } from "../api/projectApp";
import { useLongPress } from "../hooks/useLongPress";
import { useVersion } from "../hooks/useVersion";
import { activityBus } from "../lib/activityBus";
import { UI_KEYS } from "../lib/storageKeys";
import { artifactAudience } from "../lib/artifactPreview";
import type { VoiceInputButtonRef } from "./VoiceInputButton";
import { ViewerWindowActions } from "./ViewerWindowActions";
import { ComposerMicAction } from "./ComposerMicAction";
import { AppViewerToolbar } from "./AppViewerToolbar";
import { LastViewIcon } from "./LastViewIcon";
import { ProjectAppIcon } from "./ProjectAppIcon";
import actions from "./ViewerWindowActions.module.css";
import styles from "./ProjectAppViewer.module.css";
import { useI18n } from "../i18n";

/** While a project agent works, how often an open static app is checked. */
const STATIC_WATCH_INTERVAL_MS = 2000;
/** How long checks continue after the project's agents stop working. */
const STATIC_WATCH_TAIL_MS = 20_000;

function Glyph({ path }: { path: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/** The same full-height app surface in a project's main pane or a session pane. */
export function ProjectAppViewer({
  projectId,
  initialTarget,
  onTarget,
  onBack,
  onSession,
  voice,
  onVoice,
  initialSettings = false,
  onFullView,
  presentation = "viewer",
  offerLatestArtifact = true,
  projectName,
  onInfoChanged,
  onAddressesChanged,
}: {
  projectId: string;
  initialTarget?: ProjectAppTarget;
  onTarget?: (target: ProjectAppTarget) => void;
  onBack?: () => void;
  onSession?: () => void;
  voice?: VoiceInputButtonRef | null;
  onVoice?: () => void;
  initialSettings?: boolean;
  /** Offered in a session pane: fill the whole window with the app. */
  onFullView?: () => void;
  /** Inline project settings use the same controls without opening an app. */
  presentation?: "viewer" | "settings";
  /** False where the host already offers an artifact, such as a session's App. */
  offerLatestArtifact?: boolean;
  /** Names the app in its bar; the server's view label is generic. */
  projectName?: string;
  onInfoChanged?: (info: ProjectAppInfo) => void;
  onAddressesChanged?: (addresses: ProjectAppAddresses) => void;
}) {
  const { version } = useVersion();
  const { t } = useI18n();
  const viewerRef = useRef<HTMLElement>(null);
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectService.name,
  );
  const addressesSupported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectAppReservations.name,
  );
  const [info, setInfo] = useState<ProjectAppInfo | null>(null);
  const livePreviewSupported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectLivePreview.name,
  );
  const [target, setTarget] = useState<ProjectAppTarget | undefined>(
    initialTarget,
  );
  const [view, setView] = useState<ProjectAppView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettings] = useState(initialSettings);
  const settings = presentation === "settings" || settingsOpen;
  const [share, setShare] = useState<ProjectAppView | null>(null);
  const [addresses, setAddresses] = useState<ProjectAppAddresses | null>(null);
  const [name, setName] = useState("");
  const [publicAccess, setPublicAccess] = useState<boolean>();
  const [autoStartChoice, setAutoStartChoice] = useState<boolean>();
  const [reload, setReload] = useState(0);
  // The launch (view id) whose link was copied; a restart starts a new launch.
  const [copiedLaunch, setCopiedLaunch] = useState<string | null>(null);
  // The static app's change stamp when the frame loaded; a newer one means
  // the frame shows stale content.
  const [shownStamp, setShownStamp] = useState<string>();
  const autoReloadKey = `${UI_KEYS.projectAppAutoReload}:${projectId}`;
  const [autoReload, setAutoReload] = useState(
    () => localStorage.getItem(autoReloadKey) === "1",
  );
  // A plain reload with nothing new waits to reload once on the next change.
  const [reloadArmed, setReloadArmed] = useState(false);
  const audience = artifactAudience(window.location.hostname);
  const refresh = useCallback(async () => {
    const next = await projectAppApi.info(projectId);
    setInfo(next);
    return next;
  }, [projectId]);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    void projectAppApi
      .info(projectId)
      .then((next) => {
        if (!active) return;
        setInfo(next);
        setTarget(
          (previous) =>
            previous ??
            (next.declaration || next.activeDeclaration
              ? { target: "app" }
              : next.latestArtifact
                ? { target: "artifact", artifactId: next.latestArtifact.id }
                : undefined),
        );
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [projectId, supported]);
  const targetKind = target?.target;
  const artifactId = target?.artifactId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload deliberately renews the view grant even when its target is unchanged.
  useEffect(() => {
    if (!supported || !targetKind || presentation === "settings") return;
    let active = true;
    setView(null);
    setError("");
    void (async () => {
      // The stamp is read before opening, so a change racing the open shows
      // as newer content rather than going unnoticed.
      const before =
        targetKind === "app" ? await projectAppApi.info(projectId) : null;
      const next = await projectAppApi.open(
        projectId,
        { target: targetKind, artifactId },
        audience,
      );
      if (!active) return;
      setShownStamp(before?.updatedAt);
      setView(next);
    })().catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [
    projectId,
    targetKind,
    artifactId,
    audience,
    supported,
    reload,
    presentation,
  ]);
  useEffect(() => {
    if (target) onTarget?.(target);
  }, [target, onTarget]);
  // The bar shows whether the app is shared and copies its served address,
  // so addresses load with the app and refresh when settings open.
  useEffect(() => {
    if (!addressesSupported) return;
    let active = true;
    void projectAppApi
      .addresses(projectId)
      .then((next) => {
        if (active) setAddresses(next);
      })
      // Only open settings report a failure; the bar just lacks the status.
      .catch((reason: Error) => active && settings && setError(reason.message));
    return () => {
      active = false;
    };
  }, [projectId, settings, addressesSupported]);
  async function perform(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      const next = await refresh();
      onInfoChanged?.(next);
      if (addressesSupported) {
        const nextAddresses = await projectAppApi.addresses(projectId);
        setAddresses(nextAddresses);
        onAddressesChanged?.(nextAddresses);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  // A running app reads its start-time configuration again only from a fresh
  // process, in the same mode. The fresh launch also signs a new launch link,
  // which is how that link is revoked.
  async function restart() {
    await projectAppApi.action(projectId, "stop");
    await projectAppApi.action(
      projectId,
      "start",
      info?.mode === "live-preview" ? { mode: "live-preview" } : {},
    );
    setReload((value) => value + 1);
  }
  const restartPress = useLongPress(() => void perform(restart));
  const details = settings;
  const declaration = info?.activeDeclaration ?? info?.declaration;
  const served = addresses?.reservations.find(
    (row) => row.namespace === addresses.namespace && row.serving,
  );
  // The served address is the app's stable link; the view URL is a launch grant.
  const servedUrl =
    targetKind === "app" &&
    served?.url &&
    serverHasCapability(
      version,
      SERVER_CAPABILITIES.projectAppAddressLinks.name,
    )
      ? served.url
      : undefined;
  const command =
    declaration && "start" in declaration
      ? declaration.start.argv.join(" ")
      : undefined;
  // A served address reaches a process app only while it runs; a static app
  // is served from its files with no process.
  const processAppStopped =
    !!info &&
    !info.activeDeclaration &&
    info.declaration?.where.kind === "process";
  const canStartApp = processAppStopped && (info.canStart ?? info.canExecute);
  // A static app is its files, so YA can tell when the shown frame is stale.
  const watching =
    presentation === "viewer" &&
    targetKind === "app" &&
    view?.kind === "static" &&
    shownStamp !== undefined;
  const stale =
    watching && info?.updatedAt !== undefined && info.updatedAt !== shownStamp;
  // Files change when something works on them, so readings follow that work:
  // while an agent in this project is mid-turn and briefly after, and when
  // the user returns to the page (perhaps from an editor). Otherwise the
  // viewer reads nothing.
  useEffect(() => {
    if (!watching) return;
    const working = new Set<string>();
    let tailUntil = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      // A missed reading only delays the hint; a later one retries.
      void projectAppApi.info(projectId).then(setInfo, () => {});
    };
    const schedule = () => {
      clearTimeout(timer);
      if (working.size === 0 && Date.now() >= tailUntil) return;
      timer = setTimeout(() => {
        check();
        schedule();
      }, STATIC_WATCH_INTERVAL_MS);
    };
    const stopActivity = activityBus.on("process-state-changed", (event) => {
      if (event.projectId !== projectId) return;
      if (event.activity === "in-turn") working.add(event.sessionId);
      else {
        working.delete(event.sessionId);
        tailUntil = Date.now() + STATIC_WATCH_TAIL_MS;
        check();
      }
      schedule();
    });
    const returned = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", returned);
    window.addEventListener("focus", returned);
    return () => {
      clearTimeout(timer);
      stopActivity();
      document.removeEventListener("visibilitychange", returned);
      window.removeEventListener("focus", returned);
    };
  }, [watching, projectId]);
  useEffect(() => {
    if (!stale || !(autoReload || reloadArmed)) return;
    setReloadArmed(false);
    setReload((value) => value + 1);
  }, [stale, autoReload, reloadArmed]);
  return (
    <section
      ref={viewerRef}
      className={
        presentation === "settings" ? styles.inlineSettings : styles.viewer
      }
      aria-label={t("projectAppTitle")}
    >
      {presentation === "viewer" && (
        <AppViewerToolbar viewerRef={viewerRef}>
          <div className={actions.actions}>
            <button
              type="button"
              aria-label={t("projectAppBack")}
              title={t("projectAppBack")}
              onClick={() => {
                if (details) {
                  setSettings(false);
                } else if (targetKind === "artifact" && declaration) {
                  // An artifact opened from the controls sits over the
                  // project's own app, so Back returns to it.
                  setTarget({ target: "app" });
                } else {
                  onBack?.();
                }
              }}
            >
              <Glyph path="M15 5l-7 7 7 7" />
            </button>
          </div>
          <span className={styles.title}>
            {/* Home: the app at its entry route, from an artifact or a page
                navigated within the app. Back keeps the frame's own history. */}
            <button
              type="button"
              className={styles.home}
              title={t("projectAppHome")}
              disabled={!declaration}
              onClick={() => {
                if (targetKind === "artifact") {
                  setTarget({ target: "app" });
                  return;
                }
                void refresh().catch((reason: Error) =>
                  setError(reason.message),
                );
                setReload((value) => value + 1);
              }}
            >
              <ProjectAppIcon />
              <span className={styles.titleText}>
                {projectName ??
                  (targetKind === "artifact" ? undefined : view?.label) ??
                  t("projectAppLabel")}
              </span>
            </button>
            {targetKind === "artifact" && view && (
              <>
                <LastViewIcon />
                <span className={styles.titleText}>{view.label}</span>
              </>
            )}
          </span>
          <div className={actions.actions}>
            {onFullView && (
              <button
                type="button"
                title={t("projectAppFullView")}
                aria-label={t("projectAppFullView")}
                onClick={onFullView}
              >
                <Glyph path="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </button>
            )}
            {info?.canExecute && onSession && (
              <button
                type="button"
                title={t("projectAppNewSession")}
                aria-label={t("projectAppNewSession")}
                onClick={onSession}
              >
                <Glyph path="M12 4v16M4 12h16" />
              </button>
            )}
            {info?.canExecute && (
              <ComposerMicAction voice={voice} onActivate={onVoice} />
            )}
            {info?.latestArtifact &&
              (offerLatestArtifact || targetKind === "artifact") && (
                // Always reachable: the controls offering it hide once a view loads.
                <button
                  type="button"
                  title={t("projectAppLatest", {
                    label: info.latestArtifact.label,
                  })}
                  aria-label={t("projectAppLatest", {
                    label: info.latestArtifact.label,
                  })}
                  aria-pressed={targetKind === "artifact"}
                  disabled={targetKind === "artifact" && !declaration}
                  onClick={() => {
                    setTarget(
                      targetKind === "artifact"
                        ? { target: "app" }
                        : {
                            target: "artifact",
                            artifactId: info.latestArtifact!.id,
                          },
                    );
                    setSettings(false);
                  }}
                >
                  <LastViewIcon />
                </button>
              )}
            {/* Settings hold sharing too. Everyone may see sharing status and
                copy its links; each control there is gated on its own right. */}
            <button
              type="button"
              title={t("projectAppSettings")}
              aria-label={t("projectAppSettings")}
              onClick={() => {
                setSettings(true);
                void refresh().catch((reason: Error) =>
                  setError(reason.message),
                );
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </button>
          </div>
          {livePreviewSupported &&
            info?.livePreview &&
            info.canExecute &&
            targetKind === "app" && (
              <div className={actions.actions}>
                <button
                  type="button"
                  className={`${actions.textAction} ${styles.livePreviewToggle}`}
                  aria-pressed={info.mode === "live-preview"}
                  disabled={
                    busy ||
                    (!!info.activeDeclaration && info.mode !== "live-preview")
                  }
                  onClick={() =>
                    void perform(async () => {
                      await projectAppApi.action(
                        projectId,
                        info.mode === "live-preview" ? "stop" : "start",
                        info.mode === "live-preview"
                          ? {}
                          : { mode: "live-preview" },
                      );
                      setReload((value) => value + 1);
                    })
                  }
                >
                  {t("projectAppLivePreview")}
                </button>
              </div>
            )}
          {view && (
            <ViewerWindowActions
              url={view.url}
              copyUrl={servedUrl ?? view.url}
              copyLink={info?.canCopyLink !== false}
              // Tinted while a handed-out link works: a served address, or the
              // launch link once copied, until a restart revokes it.
              copyLinkActive={!!servedUrl || copiedLaunch === view.id}
              onCopied={() => setCopiedLaunch(view.id)}
              afterCopyLink={
                // A restart revokes the launch link (a configured address is
                // left alone), so it sits beside the link it invalidates.
                view.kind === "service" &&
                info?.activeDeclaration &&
                info.canExecute && (
                  <button
                    type="button"
                    disabled={busy}
                    title={t("projectAppRestartRevokes")}
                    aria-label={t("projectAppRestart")}
                    // A held press or right-click is deliberate enough to skip
                    // the confirmation a stray tap gets.
                    {...restartPress.handlers}
                    onClick={restartPress.click(() => {
                      if (window.confirm(t("projectAppRestartConfirm")))
                        void perform(restart);
                    })}
                  >
                    <Glyph path="M12 3v8M7.5 6.5a7 7 0 1 0 9 0" />
                  </button>
                )
              }
              copyNotice={
                served && servedUrl
                  ? `${t("projectAppServing")}: ${served.name}.${served.namespace}`
                  : `${t("projectAppLinkWarning")} ${view.expiresAt ? t("projectAppExpires", { date: new Date(view.expiresAt).toLocaleString() }) : t("projectAppLaunchLifetime")}`
              }
              onReload={() => {
                void refresh().catch((reason: Error) =>
                  setError(reason.message),
                );
                // Nothing new yet: also reload once when something is.
                if (watching && !stale && !autoReload) setReloadArmed(true);
                setReload((value) => value + 1);
              }}
              reloadState={
                !watching
                  ? undefined
                  : stale
                    ? "stale"
                    : autoReload
                      ? "auto"
                      : reloadArmed
                        ? "armed"
                        : undefined
              }
              reloadTitle={
                !watching
                  ? undefined
                  : t(
                      stale
                        ? "projectAppReloadNewer"
                        : autoReload
                          ? "projectAppReloadAuto"
                          : reloadArmed
                            ? "projectAppReloadArmed"
                            : "projectAppReloadWatch",
                    )
              }
              onReloadHold={
                watching
                  ? () => {
                      const next = !autoReload;
                      if (next) localStorage.setItem(autoReloadKey, "1");
                      else localStorage.removeItem(autoReloadKey);
                      setAutoReload(next);
                      setReloadArmed(false);
                    }
                  : undefined
              }
              onMoveOut={() => {}}
            />
          )}
        </AppViewerToolbar>
      )}
      <div className={styles.details} hidden={!details && !!view && !error}>
        {!supported ? (
          <p>{t("projectAppUpdateRequired")}</p>
        ) : (
          <>
            {error && <p role="alert">{error}</p>}
            {(!view || settings) && (
              <>
                <p>
                  {info
                    ? t("projectAppState", { state: info.state })
                    : t("projectAppLoading")}
                </p>
                {info?.error && <p>{info.error}</p>}
                {info?.restartRequired && <p>{t("projectAppChanged")}</p>}
                {livePreviewSupported &&
                  info?.livePreview &&
                  info.canExecute &&
                  !info.activeDeclaration && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await projectAppApi.action(projectId, "start", {
                            mode: "live-preview",
                          });
                          setReload((value) => value + 1);
                        })
                      }
                    >
                      {t("projectAppLivePreview")}
                    </button>
                  )}
                {info &&
                  (info.activeDeclaration
                    ? info.canExecute
                    : (info.canStart ?? info.canExecute) &&
                      info.declaration?.where.kind === "process") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await projectAppApi.action(
                            projectId,
                            info.activeDeclaration ? "stop" : "start",
                          );
                          setReload((value) => value + 1);
                        })
                      }
                    >
                      {t(
                        busy
                          ? "projectAppWorking"
                          : info.activeDeclaration
                            ? "projectAppStop"
                            : "projectAppStart",
                      )}
                    </button>
                  )}
                {info?.activeDeclaration && info.canExecute && (
                  <button
                    type="button"
                    disabled={busy}
                    title={t("projectAppRestartTitle")}
                    onClick={() => void perform(restart)}
                  >
                    {t("projectAppRestart")}
                  </button>
                )}
                {info?.state === "none" && !info.latestArtifact && (
                  <p>{t("projectAppEmpty")}</p>
                )}
                {declaration && (
                  <dl>
                    <dt>{t("projectAppDirectory")}</dt>
                    <dd>
                      <code>
                        {declaration.where.kind === "static"
                          ? declaration.where.root
                          : declaration.where.cwd}
                      </code>
                    </dd>
                    <dt>{t("projectAppEntry")}</dt>
                    <dd>
                      <code>{declaration.where.entry}</code>
                    </dd>
                    {command && (
                      <>
                        <dt>{t("projectAppCommand")}</dt>
                        <dd>
                          <code>{command}</code>
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                {presentation === "viewer" && info?.latestArtifact && (
                  <button
                    type="button"
                    className={styles.iconLabel}
                    onClick={() => {
                      setTarget({
                        target: "artifact",
                        artifactId: info.latestArtifact!.id,
                      });
                      setSettings(false);
                    }}
                  >
                    <LastViewIcon />
                    {t("projectAppLatest", {
                      label: info.latestArtifact.label,
                    })}
                  </button>
                )}
                {presentation === "viewer" &&
                  (info?.declaration || info?.activeDeclaration) && (
                    <button
                      type="button"
                      onClick={() => {
                        setTarget({ target: "app" });
                        setSettings(false);
                      }}
                    >
                      {t("projectAppLabel")}
                    </button>
                  )}
                {info?.removedFrom.map((row) => (
                  <p key={row.username}>
                    {t("projectAppRemoved", {
                      username: row.username,
                      date: new Date(row.at).toLocaleString(),
                    })}{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          projectAppApi.action(projectId, "restore", {
                            username: row.username,
                          }),
                        )
                      }
                    >
                      {t("projectAppRestore")}
                    </button>
                  </p>
                ))}
              </>
            )}
            {/* Only an administrator can act on why sharing is unavailable. */}
            {settings &&
              presentation === "viewer" &&
              info &&
              !info.canShare &&
              info.canPublish && <p>{t("projectAppShareUnavailable")}</p>}
            {settings && presentation === "viewer" && info?.canShare && (
              <>
                <p>{t("projectAppLinkWarning")}</p>
                <button
                  type="button"
                  disabled={busy || !target}
                  onClick={() =>
                    void perform(async () => {
                      setShare(
                        await projectAppApi.open(projectId, target!, "public"),
                      );
                    })
                  }
                >
                  {t("projectAppCreateLink")}
                </button>
                {share && (
                  <>
                    <p>
                      {share.expiresAt
                        ? t("projectAppExpires", {
                            date: new Date(share.expiresAt).toLocaleString(),
                          })
                        : t("projectAppLaunchLifetime")}
                    </p>
                    <ViewerWindowActions url={share.url} onMoveOut={() => {}} />
                  </>
                )}
              </>
            )}
            {details && addresses?.enabled && (
              <fieldset>
                <legend>{t("projectAppAddress")}</legend>
                {addresses.reservations.map((row) => (
                  <div key={`${row.namespace}/${row.name}`}>
                    <p>
                      <strong>
                        {row.name}.{row.namespace}
                      </strong>{" "}
                      · {row.owner} ·{" "}
                      {t(
                        row.namespace === addresses.namespace
                          ? row.serving
                            ? "projectAppServing"
                            : "projectAppReserved"
                          : "projectAppPreviousNamespace",
                      )}{" "}
                      ·{" "}
                      {t(row.public ? "projectAppPublic" : "projectAppPrivate")}
                    </p>
                    {row.url &&
                      serverHasCapability(
                        version,
                        SERVER_CAPABILITIES.projectAppAddressLinks.name,
                      ) && (
                        <div className={styles.addressLink}>
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.url}
                          </a>
                          <ViewerWindowActions
                            url={row.url}
                            moveOut={false}
                            copyLabel={t("fileLinkMenuCopyViewerLink")}
                          />
                        </div>
                      )}
                    {row.serving &&
                      row.namespace === addresses.namespace &&
                      processAppStopped &&
                      (addresses.autoStart?.enabled &&
                      !addresses.autoStart.paused ? (
                        <p role="status">
                          {t("projectAppServedStoppedAutoStart", {
                            address: `${row.name}.${row.namespace}`,
                          })}
                        </p>
                      ) : (
                        <p role="status" className={styles.servedStopped}>
                          {t("projectAppServedStopped", {
                            address: `${row.name}.${row.namespace}`,
                          })}
                        </p>
                      ))}
                    {!addresses.canPublish &&
                      !row.public &&
                      row.namespace === addresses.namespace && (
                        <p>{t("projectAppPublicNeedsAdministrator")}</p>
                      )}
                    {addresses.canPublish && (
                      <>
                        {row.namespace === addresses.namespace && (
                          <>
                            {row.privateOnly ? (
                              <p>{t("projectAppPrivateOnly")}</p>
                            ) : (
                              <label className={styles.checkLabel}>
                                <input
                                  type="checkbox"
                                  checked={publicAccess ?? row.public}
                                  disabled={busy}
                                  onChange={(event) =>
                                    setPublicAccess(event.target.checked)
                                  }
                                />
                                {t("projectAppPublic")}
                              </label>
                            )}
                            {!row.privateOnly &&
                              publicAccess !== undefined &&
                              publicAccess !== row.public && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void perform(async () => {
                                      await projectAppApi.addressAction(
                                        projectId,
                                        "serve",
                                        {
                                          serving: row.serving,
                                          public: publicAccess,
                                        },
                                      );
                                      setPublicAccess(undefined);
                                    })
                                  }
                                >
                                  {t("projectAppSaveAccess")}
                                </button>
                              )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void perform(async () => {
                                  // Serving a stopped process app would only
                                  // publish "not serving", so start it first.
                                  const startFirst =
                                    !row.serving && canStartApp;
                                  if (startFirst)
                                    await projectAppApi.action(
                                      projectId,
                                      "start",
                                    );
                                  await projectAppApi.addressAction(
                                    projectId,
                                    "serve",
                                    {
                                      serving: !row.serving,
                                      public: row.public,
                                    },
                                  );
                                  if (startFirst)
                                    setReload((value) => value + 1);
                                })
                              }
                            >
                              {t(
                                row.serving
                                  ? "projectAppUnserve"
                                  : canStartApp
                                    ? "projectAppStartAndServe"
                                    : "projectAppServe",
                              )}
                            </button>
                            {addresses.autoStart &&
                              declaration?.where.kind === "process" &&
                              serverHasCapability(
                                version,
                                SERVER_CAPABILITIES.projectAppAutoStart.name,
                              ) && (
                                <>
                                  <label className={styles.checkLabel}>
                                    <input
                                      type="checkbox"
                                      checked={
                                        autoStartChoice ??
                                        addresses.autoStart.enabled
                                      }
                                      disabled={busy}
                                      onChange={(event) => {
                                        // Show the choice at once; the refreshed
                                        // addresses then confirm or revert it.
                                        const enabled = event.target.checked;
                                        setAutoStartChoice(enabled);
                                        void perform(() =>
                                          projectAppApi.addressAction(
                                            projectId,
                                            "auto-start",
                                            { enabled },
                                          ),
                                        ).finally(() =>
                                          setAutoStartChoice(undefined),
                                        );
                                      }}
                                    />
                                    {t("projectAppAutoStart")}
                                  </label>
                                  {addresses.autoStart.paused && (
                                    <p role="status">
                                      {t("projectAppAutoStartPaused", {
                                        error: addresses.autoStart.paused,
                                      })}
                                    </p>
                                  )}
                                </>
                              )}
                          </>
                        )}
                        {(addresses.canRelease ?? addresses.canPublish) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t("projectAppReleaseConfirm", {
                                    address: `${row.name}.${row.namespace}`,
                                  }),
                                )
                              )
                                void perform(() =>
                                  projectAppApi.addressAction(
                                    projectId,
                                    "release",
                                    { namespace: row.namespace },
                                  ),
                                );
                            }}
                          >
                            {t("projectAppRelease")}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {!addresses.reservations.some(
                  (row) => row.namespace === addresses.namespace,
                ) &&
                  addresses.canReserve && (
                    <>
                      <label>
                        {t("projectAppName")}
                        <input
                          value={name}
                          placeholder={`${addresses.requiredPrefix}canvas`}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || !name.trim()}
                        onClick={() =>
                          void perform(() =>
                            projectAppApi.addressAction(projectId, "reserve", {
                              name,
                            }),
                          )
                        }
                      >
                        {t("projectAppReserve")}
                      </button>
                      <p>{t("projectAppReserveHint")}</p>
                    </>
                  )}
              </fieldset>
            )}
          </>
        )}
      </div>
      {view && (
        <iframe
          key={`${view.id}:${reload}`}
          hidden={details}
          className={styles.frame}
          title={view.label}
          src={view.url}
          sandbox={
            view.kind === "service"
              ? "allow-scripts allow-same-origin allow-forms allow-downloads"
              : ARTIFACT_SANDBOX
          }
          referrerPolicy="no-referrer"
        />
      )}
    </section>
  );
}
