import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import { useId, useState } from "react";
import { CommittedRangeNumberInput } from "../../components/ui/CommittedRangeNumberInput";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { SettingsSection } from "./SettingsSection";
import styles from "./ArtifactSettings.module.css";

export function ArtifactSettings() {
  const { version, refetch } = useVersion();
  const status = version?.artifactViewer;
  // Metadata is also present when serving is disabled; old servers expose no form.
  return status ? (
    <ArtifactSettingsForm
      key={JSON.stringify(status)}
      status={status}
      onSaved={refetch}
    />
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
  const expiryId = useId();
  const [localEnabled, setLocalEnabled] = useState(!!status.localOrigin);
  const [localOrigin, setLocalOrigin] = useState(
    status.localOrigin ?? status.defaultLocalOrigin,
  );
  const [publicOrigin, setPublicOrigin] = useState(status.publicOrigin ?? "");
  const [port, setPort] = useState(String(status.port));
  const [expiryHours, setExpiryHours] = useState(status.expiryHours);
  const [expiryDays, setExpiryDays] = useState(status.expiryDays);
  const [deleteOnExpiry, setDeleteOnExpiry] = useState(
    status.deleteOnExpiry === true,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setMessage("");
    setSaving(true);
    try {
      const origins = [localEnabled ? localOrigin : "", publicOrigin].filter(
        Boolean,
      );
      if (
        origins.some(
          (value) => new URL(value).hostname === window.location.hostname,
        )
      ) {
        throw new Error(t("artifactSeparateHost"));
      }
      await transport.fetch("/artifacts/config", {
        method: "PUT",
        body: JSON.stringify({
          port: Number(port),
          localOrigin: localEnabled ? localOrigin.trim() : "",
          publicOrigin: publicOrigin.trim(),
          // A server that reports days takes days; an older one keeps hours.
          ...(expiryDays === undefined
            ? { expiryHours }
            : { expiryDays, deleteOnExpiry }),
        }),
      });
      setMessage(t("artifactSaved"));
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title={t("artifactSettingsTitle")}
      description={t("artifactSettingsDescription")}
    >
      <fieldset className={styles.fields} disabled={status.locked || saving}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={localEnabled}
            onChange={(e) => setLocalEnabled(e.target.checked)}
          />
          {t("artifactLocalEnabled")}
        </label>
        {localEnabled && (
          <label>
            {t("artifactLocalOrigin")}
            <input
              type="url"
              value={localOrigin}
              onChange={(e) => setLocalOrigin(e.target.value)}
            />
          </label>
        )}
        <label>
          {t("artifactPublicOrigin")}
          <input
            type="url"
            value={publicOrigin}
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
                onCommit={setExpiryDays}
              />
            </div>
            <p>{t("artifactExpiryDaysHint")}</p>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={deleteOnExpiry}
                onChange={(e) => setDeleteOnExpiry(e.target.checked)}
              />
              {t("artifactDeleteOnExpiry")}
            </label>
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
                  onCommit={setExpiryHours}
                />
              </div>
              <p>{t("artifactExpiryHint")}</p>
            </>
          )
        )}
        <button type="button" onClick={() => void save()}>
          {t(saving ? "artifactSaving" : "artifactSave")}
        </button>
      </fieldset>
      {status.locked && <p>{t("artifactLocked")}</p>}
      {message && <p role="status">{message}</p>}
    </SettingsSection>
  );
}
