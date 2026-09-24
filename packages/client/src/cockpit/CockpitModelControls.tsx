import { useMemo, useState } from "react";
import { api } from "../api/client";
import { LongContextEffortWarningModal } from "../components/LongContextEffortWarningModal";
import { ModelSwitchModal } from "../components/ModelSwitchModal";
import { useLongContextEffortGuard } from "../hooks/useLongContextEffortGuard";
import { useProviders } from "../hooks/useProviders";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import type { SessionMetadata, SessionStatus } from "../types";
import styles from "./CockpitModelControls.module.css";

export interface CockpitModelControlsProps {
  actualSessionId: string;
  projectId: string;
  reconnectStream: () => void;
  session: SessionMetadata | null;
  setSessionModel: (model: string) => void;
  setStatus: (status: SessionStatus) => void;
  status: SessionStatus;
}

export function CockpitModelControls({
  actualSessionId,
  projectId,
  reconnectStream,
  session,
  setSessionModel,
  setStatus,
  status,
}: CockpitModelControlsProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { providers } = useProviders();
  const { settings } = useServerSettings();
  const providerInfo = useMemo(
    () => providers.find((provider) => provider.name === session?.provider),
    [providers, session?.provider],
  );
  const effort = session?.effectiveModelSettings?.effort;
  const guard = useLongContextEffortGuard({
    provider: session?.provider,
    providerInfo,
    model:
      session?.effectiveModelSettings?.requestedModel ?? session?.model ?? undefined,
    contextTokens: session?.contextUsage?.inputTokens,
    settings: settings?.longContextEffortWarning,
    canFork: false,
    forkWithThinking: async () => {},
    translateEffort: t,
    noEffortLabel: t("longContextEffortWarningNoEffort"),
  });

  return (
    <>
      <button
        aria-label={t("modelSwitchTitle")}
        className={styles.trigger}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span>{session?.provider ?? t("cockpitUnknownProject")}</span>
        <strong>{session?.model ?? t("processInfoDefaultModel")}</strong>
        {effort && <em>{effort}</em>}
      </button>

      {open && (
        <ModelSwitchModal
          currentModel={session?.model}
          guardEffortChange={guard.guardEffortChange}
          onActivate={async () => {
            const result = await api.reactivateSession(
              projectId,
              actualSessionId,
            );
            setStatus({
              owner: "self",
              processId: result.processId,
              permissionMode: result.permissionMode,
              appliedPermissionMode: result.appliedPermissionMode,
              modeVersion: result.modeVersion,
              recapAfterSeconds: result.recapAfterSeconds,
            });
          }}
          onClose={() => setOpen(false)}
          onModelChanged={(next) => {
            if (next.model) setSessionModel(next.model);
            if (status.owner === "self" && status.processId !== next.processId) {
              setStatus({ owner: "self", processId: next.processId });
              reconnectStream();
            }
          }}
          processId={status.owner === "self" ? status.processId : undefined}
          sessionId={actualSessionId}
          sessionProvider={session?.provider}
        />
      )}

      {guard.warning && (
        <LongContextEffortWarningModal
          busy={guard.warning.busy}
          canFork={guard.warning.canFork}
          contextTokens={guard.warning.contextTokens}
          currentEffortLabel={guard.warning.currentEffortLabel}
          nextEffortLabel={guard.warning.nextEffortLabel}
          onChoose={(choice) => void guard.choose(choice)}
          provider={guard.warning.provider}
        />
      )}
    </>
  );
}
