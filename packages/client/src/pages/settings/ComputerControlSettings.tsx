import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { SettingsSection } from "./SettingsSection";
import styles from "./ComputerControlSettings.module.css";

interface Status {
  enabled: boolean;
  available: boolean;
  running: boolean;
  busy: boolean;
  idleMs: number;
  grantMs: number;
  lastError?: string;
  preview?: { packageDirectory: string; trustedPublisher: string };
  sessions: Array<{ sessionId: string; expiresAt: number }>;
  release?: {
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable: boolean;
    autoUpdate: boolean;
    working: boolean;
    error?: string;
    progress?: { phase: string; received?: number; total?: number };
  };
}
export function ComputerControlSettings() {
  const { version } = useVersion();
  const { sourceKey } = useCurrentSourceRuntime();
  const { t } = useI18n();
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.computerControl.name,
  );
  const managed = serverHasCapability(
    version,
    SERVER_CAPABILITIES.computerControlReleases.name,
  );
  return (
    <SettingsSection
      title={t("computerTitle")}
      description={t("computerDescription")}
    >
      {supported ? (
        <Controls key={sourceKey} managed={managed} />
      ) : (
        <p>{t("computerUnsupportedServer")}</p>
      )}
    </SettingsSection>
  );
}
function Controls({ managed }: { managed: boolean }) {
  const { transport } = useCurrentSourceRuntime();
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>();
  const [directory, setDirectory] = useState("");
  const [publisher, setPublisher] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    void transport
      .fetch<Status>("/computer-control")
      .then((value) => {
        if (disposed) return;
        setStatus(value);
        setDirectory(value.preview?.packageDirectory ?? "");
        setPublisher(value.preview?.trustedPublisher ?? "");
      })
      .catch(() => {
        if (!disposed) setError(t("computerRequestFailed"));
      });
    return () => {
      disposed = true;
    };
  }, [transport, t]);
  // Poll only a server-owned operation while this settings view is mounted.
  useEffect(() => {
    if (!status?.release?.working) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void transport
        .fetch<Status>("/computer-control")
        .then((value) => {
          if (!disposed) setStatus(value);
        })
        .catch(() => {
          if (!disposed) {
            setError(t("computerRequestFailed"));
            setStatus((value) =>
              value
                ? {
                    ...value,
                    release: value.release
                      ? { ...value.release, working: false }
                      : undefined,
                  }
                : value,
            );
          }
        });
    }, 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [status, transport, t]);
  const action = async (route: string, method: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      await transport.fetch(`/computer-control${route}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setStatus(await transport.fetch<Status>("/computer-control"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("computerRequestFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  if (!status) return <p role="status">{error || t("computerLoading")}</p>;
  if (!status.available) return <p>{t("computerUnavailable")}</p>;
  const working = busy || status.release?.working || status.busy;
  const progress = status.release?.progress;
  const phase =
    progress?.phase === "downloading"
      ? t("computerDownloading")
      : progress?.phase === "verifying"
        ? t("computerVerifying")
        : progress?.phase === "installing"
          ? t("computerInstalling")
          : t("computerChecking");
  return (
    <div className={styles.controls}>
      {managed ? (
        <>
          <label className={styles.toggle}>
            <span>
              <strong>{t("computerManagedEnable")}</strong>
              <small>{t("computerDownloadHelp")}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={status.enabled}
              aria-label={t("computerManagedEnable")}
              checked={status.enabled}
              disabled={working}
              onChange={(event) =>
                void action("/releases/enabled", "PUT", {
                  enabled: event.currentTarget.checked,
                })
              }
            />
          </label>
          {status.release?.working ? (
            <div role="status">
              <p>{phase}</p>
              <progress
                max={progress?.total}
                value={progress?.total ? progress.received : undefined}
                aria-label={phase}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void action("/releases/enabled", "PUT", { enabled: false })
                }
              >
                {t("computerCancelDownload")}
              </button>
            </div>
          ) : (
            <p role="status">
              {status.preview
                ? `${t("computerInstalled")}: ${status.release?.installedVersion ?? t("computerLocalPackage")}. ${t(status.enabled ? "computerReady" : "computerDisabled")}`
                : t("computerNotInstalled")}
            </p>
          )}
          {status.preview && status.release?.updateAvailable && (
            <div className={styles.actions}>
              <span>
                {t("computerUpdateAvailable", {
                  version: status.release.latestVersion ?? "",
                })}
              </span>
              <button
                type="button"
                disabled={working || status.sessions.length > 0}
                onClick={() => void action("/releases/update", "POST")}
              >
                {t("computerUpdateNow")}
              </button>
            </div>
          )}
          {status.preview && (
            <label className={styles.toggle}>
              <span>
                {t("computerAutoUpdate")}
                <small>{t("computerAutoUpdateHelp")}</small>
              </span>
              <input
                type="checkbox"
                checked={status.release?.autoUpdate ?? true}
                disabled={working}
                onChange={(event) =>
                  void action("/releases/automatic", "PUT", {
                    autoUpdate: event.currentTarget.checked,
                  })
                }
              />
            </label>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={working}
              onClick={() => void action("/releases/check", "POST")}
            >
              {t("computerCheckUpdates")}
            </button>
            {status.preview && (
              <button
                type="button"
                disabled={working}
                onClick={() => void action("/installation", "DELETE")}
              >
                {t("computerUninstall")}
              </button>
            )}
          </div>
          <p className={styles.help}>{t("computerSessionHelp")}</p>
        </>
      ) : (
        <>
          <p>{t("computerUpdateServer")}</p>
          {status.preview && (
            <label className={styles.toggle}>
              {t("computerEnable")}
              <input
                type="checkbox"
                checked={status.enabled}
                disabled={working}
                onChange={(event) =>
                  void action("/settings", "PUT", {
                    enabled: event.currentTarget.checked,
                    idleMs: status.idleMs,
                    grantMs: status.grantMs,
                  })
                }
              />
            </label>
          )}
        </>
      )}
      {(error || status.release?.error || status.lastError) && (
        <p role="alert">{error || status.release?.error || status.lastError}</p>
      )}
      <details className={styles.advanced}>
        <summary>{t("computerAdvanced")}</summary>
        <p>{t("computerTrustHelp")}</p>
        <label>
          {t("computerPackageDirectory")}
          <input
            value={directory}
            onChange={(event) => setDirectory(event.currentTarget.value)}
            disabled={working}
          />
        </label>
        <label>
          {t("computerTrustedPublisher")}
          <input
            value={publisher}
            onChange={(event) => setPublisher(event.currentTarget.value)}
            disabled={working}
          />
        </label>
        <button
          type="button"
          disabled={working || !directory.trim() || !publisher.trim()}
          onClick={() =>
            void action("/install", "POST", {
              packageDirectory: directory,
              trustedPublisher: publisher,
            })
          }
        >
          {t("computerInstall")}
        </button>
        <p>{t(status.running ? "computerRunning" : "computerStopped")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void action("", "GET")}
        >
          {t("computerRefresh")}
        </button>
      </details>
      {status.sessions.map((session) => (
        <div className={styles.session} key={session.sessionId}>
          <code>{session.sessionId}</code>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void action(
                `/sessions/${encodeURIComponent(session.sessionId)}`,
                "DELETE",
              )
            }
          >
            {t("computerRevoke")}
          </button>
        </div>
      ))}
    </div>
  );
}
