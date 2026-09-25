import type { EffortLevel, ModelInfo, ThinkingMode } from "@yep-anywhere/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { LongContextEffortWarningModal } from "../components/LongContextEffortWarningModal";
import { useLongContextEffortGuard } from "../hooks/useLongContextEffortGuard";
import {
  getShowThinkingSetting,
  useModelSettings,
} from "../hooks/useModelSettings";
import { useProviders } from "../hooks/useProviders";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import {
  getEffortLevelOptions,
  getThinkingModeOptions,
  resolveSupportedEffortLevel,
  resolveSupportedThinkingMode,
} from "../lib/effortLevels";
import { withVisibleModelSelection } from "../lib/modelCatalog";
import {
  getThinkingModeFromProcess,
  normalizeEffortLevel,
} from "../lib/modelConfigIndicator";
import { toThinkingOption } from "../lib/newSessionOptions";
import type { SessionMetadata, SessionStatus } from "../types";
import styles from "./CockpitModelControls.module.css";
import { CockpitModelField, CockpitThinkingField } from "./CockpitRunSettings";

export interface CockpitModelControlsProps {
  actualSessionId: string;
  projectId: string;
  reconnectStream: () => void;
  session: SessionMetadata | null;
  setSessionModel: (model: string) => void;
  setStatus: (status: SessionStatus) => void;
  status: SessionStatus;
}

interface RunState {
  model: string | null;
  thinkingMode: ThinkingMode;
  effortLevel: EffortLevel;
}

/**
 * Model and thinking for one session. With a live process the change applies
 * at once through the process config; without one it is what the next message
 * resumes with, the same stored choice the classic composer uses.
 */
export function CockpitModelControls({
  actualSessionId,
  reconnectStream,
  session,
  setSessionModel,
  setStatus,
  status,
}: CockpitModelControlsProps) {
  const { t } = useI18n();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processModels, setProcessModels] = useState<ModelInfo[] | null>(null);
  const [current, setCurrent] = useState<RunState | null>(null);
  const [draft, setDraft] = useState<RunState | null>(null);
  const { providers } = useProviders();
  const { settings } = useServerSettings();
  const { thinkingMode, effortLevel, setThinkingMode, setEffortLevel } =
    useModelSettings();
  const processId = status.owner === "self" ? status.processId : undefined;
  const providerInfo = useMemo(
    () => providers.find((provider) => provider.name === session?.provider),
    [providers, session?.provider],
  );
  const effort = session?.effectiveModelSettings?.effort;
  const guard = useLongContextEffortGuard({
    provider: session?.provider,
    providerInfo,
    model:
      session?.effectiveModelSettings?.requestedModel ??
      session?.model ??
      undefined,
    contextTokens: session?.contextUsage?.inputTokens,
    settings: settings?.longContextEffortWarning,
    canFork: false,
    forkWithThinking: async () => {},
    translateEffort: t,
    noEffortLabel: t("longContextEffortWarningNoEffort"),
  });

  // Load what is in effect whenever the panel opens.
  // Only re-read on open or when the process changes, not on every
  // stored-setting update while the panel is being edited.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!open) return;
    setError(null);
    // Never show or apply values read for an earlier process.
    setProcessModels(null);
    setCurrent(null);
    setDraft(null);
    if (!processId) {
      const idle = {
        model: session?.model ?? null,
        thinkingMode,
        effortLevel,
      };
      setLoading(false);
      setCurrent(idle);
      setDraft(idle);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getProcessModels(processId),
      api.getProcessInfo(actualSessionId),
    ])
      .then(([modelsResult, infoResult]) => {
        if (cancelled) return;
        const process = infoResult.process;
        const live = {
          // The requested id matches the model list; the reported one can
          // be a resolved name or, after plan mode, a different model.
          model:
            process?.requestedModel ?? process?.model ?? session?.model ?? null,
          thinkingMode: getThinkingModeFromProcess(
            process?.thinking,
            process?.effort,
          ),
          effortLevel: normalizeEffortLevel(
            process?.effort,
            process?.provider ?? session?.provider,
          ),
        };
        setProcessModels(modelsResult.models);
        setCurrent(live);
        setDraft(live);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : t("modelSwitchLoadFailed"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, processId, actualSessionId]);

  // Outside click and Escape close the panel.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture phase on document runs before the global Stop shortcut,
      // which also ignores prevented events.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const models = withVisibleModelSelection(
    processModels ?? providerInfo?.models ?? [],
    draft?.model,
    t("modelSelectionUnavailable"),
  );
  const modelInfo = models.find((model) => model.id === draft?.model) ?? null;
  const effortOptions = getEffortLevelOptions({
    provider: providerInfo ?? session?.provider,
    model: modelInfo,
    translate: t,
  });
  const thinkingModes = getThinkingModeOptions({
    provider: providerInfo ?? session?.provider,
    model: modelInfo,
    effortOptions,
  });
  const effective: RunState | null = draft
    ? {
        model: draft.model,
        thinkingMode: resolveSupportedThinkingMode(
          draft.thinkingMode,
          thinkingModes,
        ),
        effortLevel: resolveSupportedEffortLevel(
          draft.effortLevel,
          effortOptions,
        ),
      }
    : null;
  const supportsThinking =
    providerInfo?.supportsThinkingToggle !== false &&
    thinkingModes.some((mode) => mode !== "off");
  const dirty =
    effective !== null &&
    current !== null &&
    (effective.model !== current.model ||
      effective.thinkingMode !== current.thinkingMode ||
      (effective.thinkingMode === "on" &&
        effective.effortLevel !== current.effortLevel));

  const apply = async () => {
    if (!effective || !current || applying) return;
    setApplying(true);
    setError(null);
    try {
      const thinking = toThinkingOption(
        effective.thinkingMode,
        effective.effortLevel,
      );
      if (processId) {
        const verdict = await guard.guardEffortChange(
          thinking,
          toThinkingOption(current.thinkingMode, current.effortLevel),
        );
        if (verdict === "skip") {
          setApplying(false);
          return;
        }
        const result = await api.setProcessConfig(processId, {
          model: effective.model ?? undefined,
          thinking,
          showThinking: getShowThinkingSetting(),
        });
        if (result.model) setSessionModel(result.model);
        if (result.processId !== processId) {
          setStatus({ owner: "self", processId: result.processId });
          reconnectStream();
        }
      } else if (effective.model && effective.model !== current.model) {
        setSessionModel(effective.model);
      }
      setThinkingMode(effective.thinkingMode);
      setEffortLevel(effective.effortLevel);
      setOpen(false);
      triggerRef.current?.focus();
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t("modelSwitchChangeFailed"),
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={t("cockpitModelPanelTitle")}
        className={styles.trigger}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span>{providerInfo?.displayName ?? session?.provider ?? ""}</span>
        <strong>{session?.model ?? t("processInfoDefaultModel")}</strong>
        {effort && <em>{effort}</em>}
      </button>

      {open && (
        <div
          aria-label={t("cockpitModelPanelTitle")}
          className={styles.panel}
          id={panelId}
          role="dialog"
        >
          <p className={styles.panelTitle}>{t("cockpitModelPanelTitle")}</p>
          {loading || !effective ? (
            <p className={styles.note} role="status">
              {error ?? t("cockpitLoadingTitle")}
            </p>
          ) : (
            <>
              <CockpitModelField
                disabled={applying}
                models={models}
                onChange={(model) =>
                  setDraft((value) => (value ? { ...value, model } : value))
                }
                value={effective.model}
              />
              {supportsThinking && (
                <CockpitThinkingField
                  disabled={applying}
                  effort={effective.effortLevel}
                  effortOptions={effortOptions}
                  mode={effective.thinkingMode}
                  modes={thinkingModes}
                  onEffortChange={(level) =>
                    setDraft((value) =>
                      value ? { ...value, effortLevel: level } : value,
                    )
                  }
                  onModeChange={(mode) =>
                    setDraft((value) =>
                      value ? { ...value, thinkingMode: mode } : value,
                    )
                  }
                />
              )}
              <p className={styles.note}>
                {processId
                  ? t("cockpitModelPanelAppliesNow")
                  : t("cockpitModelPanelAppliesNext")}
              </p>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <div className={styles.actions}>
                <button
                  className={styles.secondary}
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  type="button"
                >
                  {t("cockpitNewSessionCancel")}
                </button>
                <button
                  className={styles.primary}
                  disabled={!dirty || applying}
                  onClick={() => void apply()}
                  type="button"
                >
                  {t("cockpitModelPanelApply")}
                </button>
              </div>
            </>
          )}
        </div>
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
    </div>
  );
}
