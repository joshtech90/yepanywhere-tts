import type { ArtifactVhost, ArtifactViewerStatus } from "@yep-anywhere/shared";
import { useId, useRef, useState } from "react";
import { CommittedRangeNumberInput } from "../../components/ui/CommittedRangeNumberInput";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { SettingsSection } from "./SettingsSection";
import styles from "./ArtifactSettings.module.css";
import { useVhostAccess } from "../../hooks/useVhostAccess";
import { sessionVhostApp } from "../../lib/sessionVhostApps";
import { writeClipboardText } from "../../lib/clipboard";

export function ArtifactSettings() {
  const { sourceKey } = useCurrentSourceRuntime();
  const { version, refetch } = useVersion();
  const status = version?.artifactViewer;
  // Metadata is also present when serving is disabled; old servers expose no form.
  return status ? (
    <ArtifactSettingsForm key={sourceKey} status={status} onSaved={refetch} />
  ) : null;
}

function ArtifactSettingsForm({
  status,
  onSaved,
}: {
  status: ArtifactViewerStatus;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const access = useVhostAccess(status);
  const expiryId = useId();
  const [localEnabled, setLocalEnabled] = useState(!!status.localOrigin);
  const [localOrigin, setLocalOrigin] = useState(
    status.localOrigin ?? status.defaultLocalOrigin,
  );
  const [publicOrigin, setPublicOrigin] = useState(status.publicOrigin ?? "");
  const [port, setPort] = useState(String(status.port));
  const [expiryHours, setExpiryHours] = useState(status.expiryHours);
  const [expiryDays, setExpiryDays] = useState(status.expiryDays);
  const [vhostPublicRoot, setVhostPublicRoot] = useState(
    status.vhostPublicRoot ?? "",
  );
  const [vhosts, setVhosts] = useState<ArtifactVhost[]>(() =>
    (status.vhosts ?? []).map((row) => ({ ...row })),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const vhostsSupported = status.vhosts !== undefined;
  const pending = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const lastPayload = useRef<string | undefined>(undefined);

  async function save(
    overrides: Partial<{
      localEnabled: boolean;
      expiryDays: number;
      expiryHours: number;
      vhosts: ArtifactVhost[];
    }> = {},
  ) {
    if (status.locked) return;
    const draft = {
      localEnabled,
      expiryDays,
      expiryHours,
      vhosts,
      ...overrides,
    };
    setMessage("");
    try {
      const origins = [
        draft.localEnabled ? localOrigin : "",
        publicOrigin,
      ].filter(Boolean);
      if (
        origins.some(
          (value) => new URL(value).hostname === window.location.hostname,
        )
      ) {
        throw new Error(t("artifactSeparateHost"));
      }
      const body = JSON.stringify({
        port: Number(port),
        localOrigin: draft.localEnabled ? localOrigin.trim() : "",
        publicOrigin: publicOrigin.trim(),
        // A server that reports days takes days; an older one keeps hours.
        ...(draft.expiryDays === undefined
          ? { expiryHours: draft.expiryHours }
          : { expiryDays: draft.expiryDays }),
        ...(vhostsSupported
          ? {
              vhostPublicRoot: vhostPublicRoot.trim(),
              vhosts: draft.vhosts.map((row) => ({
                name: row.name.trim(),
                port: row.port,
                ...(row.env?.trim() ? { env: row.env.trim() } : {}),
                ...(access.supported ? { public: row.public === true } : {}),
              })),
            }
          : {}),
      });
      if (body === lastPayload.current) return;
      lastPayload.current = body;
      const revision = ++saveRevision.current;
      setSaving(true);
      const operation = pending.current.then(async () => {
        await transport.fetch("/artifacts/config", { method: "PUT", body });
        await onSaved();
      });
      pending.current = operation.catch(() => {});
      try {
        await operation;
        if (revision === saveRevision.current) setMessage(t("artifactSaved"));
      } catch (error) {
        if (revision === saveRevision.current) {
          lastPayload.current = undefined;
          setMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (revision === saveRevision.current) setSaving(false);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <SettingsSection
      title={t("artifactSettingsTitle")}
      description={t("artifactSettingsDescription")}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p>{t("appsSettingsAutosave")}</p>
      <fieldset className={styles.fields} disabled={status.locked}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={localEnabled}
            onChange={(e) => {
              setLocalEnabled(e.target.checked);
              void save({ localEnabled: e.target.checked });
            }}
          />
          {t("artifactLocalEnabled")}
        </label>
        {localEnabled && (
          <label>
            {t("artifactLocalOrigin")}
            <input
              type="url"
              value={localOrigin}
              onBlur={() => void save()}
              onChange={(e) => setLocalOrigin(e.target.value)}
            />
          </label>
        )}
        <label>
          {t("artifactPublicOrigin")}
          <input
            type="url"
            value={publicOrigin}
            onBlur={() => void save()}
            onChange={(e) => setPublicOrigin(e.target.value)}
          />
        </label>
        <p>{t("artifactPublicHint")}</p>
        <label>
          {t("artifactPort")}
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onBlur={() => void save()}
            onChange={(e) => setPort(e.target.value)}
          />
        </label>
        <p>{t("artifactPortHint")}</p>
        {expiryDays !== undefined ? (
          <>
            <div className={styles.expiry}>
              <label htmlFor={expiryId}>{t("artifactExpiryDaysLabel")}</label>
              <CommittedRangeNumberInput
                id={expiryId}
                min={1}
                max={30}
                step={1}
                value={expiryDays}
                ariaLabel={t("artifactExpiryDaysLabel")}
                onCommit={(value) => {
                  setExpiryDays(value);
                  void save({ expiryDays: value });
                }}
              />
            </div>
            <p>{t("artifactExpiryDaysHint")}</p>
            {/* No control: expiry deletion is what a capture asks for when it
                creates its link, so there is nothing here to set. */}
            <p>{t("artifactDeleteOnExpiryHint")}</p>
          </>
        ) : (
          expiryHours !== undefined && (
            <>
              <div className={styles.expiry}>
                <label htmlFor={expiryId}>{t("artifactExpiryLabel")}</label>
                <CommittedRangeNumberInput
                  id={expiryId}
                  min={1}
                  max={168}
                  step={1}
                  value={expiryHours}
                  ariaLabel={t("artifactExpiryLabel")}
                  onCommit={(value) => {
                    setExpiryHours(value);
                    void save({ expiryHours: value });
                  }}
                />
              </div>
              <p>{t("artifactExpiryHint")}</p>
            </>
          )
        )}
        {vhostsSupported && (
          <>
            <label>
              {t("artifactVhostPublicRoot")}
              <input
                type="text"
                value={vhostPublicRoot}
                onBlur={() => void save()}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setVhostPublicRoot(e.target.value)}
              />
            </label>
            <p>{t("artifactVhostPublicRootHint", { port })}</p>
            <div className={styles.vhosts}>
              <span className={styles.vhostHeading}>
                {t("artifactVhostTableTitle")}
              </span>
              <p>{t("artifactVhostTableHint")}</p>
              <p>
                {t(access.supported ? "appAccessHint" : "appAccessUnavailable")}
              </p>
              {access.error && <p role="alert">{access.error}</p>}
              {vhosts.map((row, index) => (
                <div key={index} className={styles.vhostRow}>
                  <label>
                    {t("artifactVhostName")}
                    <input
                      type="text"
                      value={row.name}
                      onBlur={() => void save()}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setVhosts((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, name: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    {t("artifactVhostPort")}
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={row.port || ""}
                      onBlur={() => void save()}
                      onChange={(e) =>
                        setVhosts((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, port: Number(e.target.value) }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    {t("artifactVhostEnv")}
                    <input
                      type="text"
                      value={row.env ?? ""}
                      onBlur={() => void save()}
                      placeholder="PLANNOTATOR_PORT"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) =>
                        setVhosts((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, env: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = vhosts.filter((_, i) => i !== index);
                      setVhosts(next);
                      void save({ vhosts: next });
                    }}
                  >
                    {t("artifactVhostRemove")}
                  </button>
                  {access.supported && (
                    <div className={styles.access}>
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={row.public === true}
                          onChange={(event) => {
                            const next = vhosts.map((item, i) =>
                              i === index
                                ? { ...item, public: event.target.checked }
                                : item,
                            );
                            setVhosts(next);
                            void save({ vhosts: next });
                          }}
                        />
                        {t("appAccessPublic")}
                      </label>
                      {status.vhosts?.some(
                        (saved) =>
                          saved.name === row.name && saved.port === row.port,
                      ) && (
                        <>
                          <button
                            type="button"
                            disabled={!access.config}
                            onClick={async () => {
                              const app = sessionVhostApp(
                                `http://localhost:${row.port}/`,
                                access.config,
                                window.location.href,
                                status.vhostPublicRoot ? "public" : undefined,
                              );
                              setMessage(
                                app && (await writeClipboardText(app.url))
                                  ? t("fileViewerCopied")
                                  : t("viewerCopyLinkFailed"),
                              );
                            }}
                          >
                            {t("appAccessCopy")}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={async () => {
                              setSaving(true);
                              try {
                                await transport.fetch(
                                  `/artifacts/vhosts/${encodeURIComponent(row.name)}/revoke`,
                                  { method: "POST" },
                                );
                                access.refresh();
                                setMessage(t("appAccessRevoked"));
                              } catch (error) {
                                setMessage(
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                                );
                              } finally {
                                setSaving(false);
                              }
                            }}
                          >
                            {t("appAccessRevoke")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setVhosts((current) => [
                    ...current,
                    { name: "", port: 19432 },
                  ])
                }
              >
                {t("artifactVhostAdd")}
              </button>
            </div>
          </>
        )}
      </fieldset>
      {status.locked && <p>{t("artifactLocked")}</p>}
      {saving && <p role="status">{t("artifactSaving")}</p>}
      {message && <p role="status">{message}</p>}
    </SettingsSection>
  );
}
