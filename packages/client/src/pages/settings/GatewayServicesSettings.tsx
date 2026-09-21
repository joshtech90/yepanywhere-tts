/**
 * Editor for the configured model-serving endpoints ("gateway services").
 *
 * One entry per endpoint: where it listens, optionally how to start and stop
 * it, what its models can hold, and which harness narrowings apply to launches
 * routed through it. The entry marked default is the one Claude Gateway falls
 * back to, and the one older clients see through the single-gateway settings.
 */

import {
  DEFAULT_GATEWAY_AUTO_STOP_SECONDS,
  DEFAULT_GATEWAY_SERVICE_CODEX_WIRE_API,
  EFFORT_LEVEL_ORDER,
  MAX_GATEWAY_SERVICES,
  MAX_GATEWAY_SERVICE_COMMAND_LENGTH,
  MAX_GATEWAY_SERVICE_LABEL_LENGTH,
  MAX_GATEWAY_SERVICE_SHORT_NAME_LENGTH,
  gatewayServiceCliInvocations,
  isEffortLevel,
  isLoopbackGatewayUrl,
  type EffortLevel,
  type GatewayService,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { useI18n } from "../../i18n";
import { useServerSettings } from "../../hooks/useServerSettings";
import styles from "./GatewayServicesSettings.module.css";

const EXAMPLE_URL = "http://127.0.0.1:8001";

/** A slug derived from a URL's host and port, unique within the draft list. */
function suggestServiceId(url: string, taken: ReadonlySet<string>): string {
  let base = "service";
  try {
    const parsed = new URL(url);
    base = `${parsed.hostname}-${parsed.port || parsed.protocol.replace(":", "")}`;
  } catch {
    // Keep the generic base; the user can rename the entry.
  }
  base =
    base
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "service";
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function newService(taken: ReadonlySet<string>): GatewayService {
  return {
    id: suggestServiceId(EXAMPLE_URL, taken),
    label: "",
    shortName: "",
    url: EXAMPLE_URL,
    enabled: true,
    autoStop: false,
    autoStopAfterSeconds: DEFAULT_GATEWAY_AUTO_STOP_SECONDS,
    // New services default into CodexOSS use: a freshly added endpoint is
    // usually the reason someone turns the provider on at all, and without an
    // allowed service CodexOSS falls back to requiring a local Ollama.
    codexEnabled: true,
    codexWireApi: DEFAULT_GATEWAY_SERVICE_CODEX_WIRE_API,
  };
}

/**
 * Adding or removing one effort level, with the default kept consistent.
 *
 * An empty list is stored as no list at all — "this endpoint states nothing",
 * which is what restores the advertised or built-in levels — and a default that
 * is no longer listed goes with it rather than becoming unreachable state.
 */
function toggledEffortLevel(
  service: GatewayService,
  level: EffortLevel,
  { checked }: { checked: boolean },
): Partial<GatewayService> {
  const levels = EFFORT_LEVEL_ORDER.filter((candidate) =>
    candidate === level
      ? checked
      : (service.effortLevels?.includes(candidate) ?? false),
  );
  const keepsDefault =
    service.defaultEffortLevel !== undefined &&
    levels.includes(service.defaultEffortLevel);
  return {
    effortLevels: levels.length ? levels : undefined,
    ...(keepsDefault ? {} : { defaultEffortLevel: undefined }),
  };
}

function sameServices(
  left: readonly GatewayService[],
  right: readonly GatewayService[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** An optional positive integer field, kept as text while being typed. */
function numberFieldValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function parseNumberField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

type OverrideValue = "inherit" | "on" | "off";

function overrideValue(value: boolean | undefined): OverrideValue {
  return value === undefined ? "inherit" : value ? "on" : "off";
}

/** What one endpoint answered when asked which efforts it accepts. */
type EffortDetection =
  | { state: "asking" }
  | { state: "answered"; levels: EffortLevel[]; modelId: string }
  | { state: "silent"; reason: EffortDetectionFailure };

type EffortDetectionFailure = "unreachable" | "no-models" | "undescribed";

const EFFORT_DETECTION_FAILURE_MESSAGES = {
  unreachable: "providersGatewayServiceEffortDetectUnreachable",
  "no-models": "providersGatewayServiceEffortDetectNoModels",
  undescribed: "providersGatewayServiceEffortDetectUndescribed",
} as const;

export function GatewayServicesSettings({
  reloadProviders,
}: {
  reloadProviders: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { settings, updateSetting, updateSettings } = useServerSettings();
  const exportEnabled = settings?.gatewayServiceExportEnabled ?? false;
  const exportPaths = settings?.gatewayServiceExportPaths;
  const savedServices = useMemo(
    () => settings?.gatewayServices ?? [],
    [settings?.gatewayServices],
  );
  const savedDefaultId = settings?.defaultGatewayServiceId;
  const [services, setServices] = useState<GatewayService[]>(savedServices);
  const [defaultId, setDefaultId] = useState<string | undefined>(
    savedDefaultId,
  );
  const [isSaving, setIsSaving] = useState(false);
  const effortDetectionEnabled =
    settings?.gatewayServiceEffortDetection ?? true;
  /** The last detection answer per service id, shown next to its button. */
  const [detections, setDetections] = useState<
    Record<string, EffortDetection | undefined>
  >({});

  /**
   * The draft as it stands right now, for the handlers that save it.
   *
   * There is no Save button to read the finished draft off the screen, so a
   * blur or a toggle saves whatever is current at that instant. React state is
   * a render behind inside the same handler that changed it, which would make a
   * toggle save the value it just replaced.
   */
  const draft = useRef({ services, defaultId });
  draft.current = { services, defaultId };

  useEffect(() => {
    setServices(savedServices);
  }, [savedServices]);

  useEffect(() => {
    setDefaultId(savedDefaultId);
  }, [savedDefaultId]);

  const hasChanges =
    !sameServices(services, savedServices) || defaultId !== savedDefaultId;

  /**
   * Write the current draft, on blur or on a toggle.
   *
   * Every field saves itself, so the list is never left holding a change the
   * user believes is configured. Saving an unchanged draft is skipped rather
   * than sent, since a blur that changed nothing should not restart the
   * providers.
   */
  const save = useCallback(async () => {
    const { services: next, defaultId: nextDefaultId } = draft.current;
    if (sameServices(next, savedServices) && nextDefaultId === savedDefaultId) {
      return;
    }
    setIsSaving(true);
    try {
      await updateSettings({
        gatewayServices: next,
        defaultGatewayServiceId: next.some(
          (service) => service.id === nextDefaultId,
        )
          ? nextDefaultId
          : next[0]?.id,
      });
      await reloadProviders();
    } catch {
      // Error handled by useServerSettings.
    } finally {
      setIsSaving(false);
    }
  }, [reloadProviders, savedDefaultId, savedServices, updateSettings]);

  const updateService = useCallback(
    (
      index: number,
      changes: Partial<GatewayService>,
      options?: { save?: boolean },
    ) => {
      const next = draft.current.services.map((service, position) =>
        position === index ? { ...service, ...changes } : service,
      );
      draft.current = { ...draft.current, services: next };
      setServices(next);
      if (options?.save) void save();
    },
    [save],
  );

  /** Replace the whole list — adding, removing, or reordering — and save it. */
  const replaceServices = useCallback(
    (next: GatewayService[]) => {
      draft.current = { ...draft.current, services: next };
      setServices(next);
      void save();
    },
    [save],
  );

  const chooseDefault = useCallback(
    (id: string) => {
      draft.current = { ...draft.current, defaultId: id };
      setDefaultId(id);
      void save();
    },
    [save],
  );

  /**
   * Move one entry within the list.
   *
   * This order is what the model pickers show, so it is worth being able to
   * set: a deliberately configured local endpoint should be able to lead
   * without having to become the default service, which means something else.
   */
  const moveService = useCallback(
    (index: number, delta: number) => {
      const current = draft.current.services;
      const target = index + delta;
      if (target < 0 || target >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      replaceServices(next);
    },
    [replaceServices],
  );

  /**
   * Ask one endpoint what it accepts and tick what it answers.
   *
   * The answer lands in the draft entry as ordinary configuration rather than
   * being applied invisibly, so it stays reviewable and trimmable before Save —
   * an endpoint states the levels its request schema accepts, which can be
   * more than the model behind it treats differently.
   *
   * Returns whether anything was ticked, so the caller can fall back when the
   * endpoint had nothing to say.
   */
  const detectEffort = useCallback(
    async (index: number) => {
      const service = draft.current.services[index];
      if (!service) return;
      setDetections((current) => ({
        ...current,
        [service.id]: { state: "asking" },
      }));
      try {
        const answer = await api.detectGatewayServiceEffort(service.url);
        if (!answer.detected) {
          setDetections((current) => ({
            ...current,
            [service.id]: { state: "silent", reason: answer.reason },
          }));
          return;
        }
        setDetections((current) => ({
          ...current,
          [service.id]: {
            state: "answered",
            levels: answer.levels,
            modelId: answer.modelId,
          },
        }));
        updateService(
          index,
          {
            effortLevels: answer.levels.length ? answer.levels : undefined,
            // The endpoint's own default is worth keeping when it named one,
            // but never over a default the user already stated and the answer
            // still lists.
            defaultEffortLevel:
              service.defaultEffortLevel !== undefined &&
              answer.levels.includes(service.defaultEffortLevel)
                ? service.defaultEffortLevel
                : answer.defaultLevel,
          },
          { save: true },
        );
        return answer.levels.length > 0;
      } catch {
        setDetections((current) => ({
          ...current,
          [service.id]: { state: "silent", reason: "unreachable" },
        }));
      }
      return false;
    },
    [updateService],
  );

  /**
   * Let the endpoint decide this service's levels.
   *
   * Stating no levels *is* how a service defers to what YA can find out, so
   * the mode is the stored list being empty rather than a separate field. The
   * global switch is turned on with it: leaving it off would make this choice
   * mean "use the built-in families only", which is not what it says.
   */
  const chooseAskedEffort = useCallback(
    async (index: number) => {
      updateService(
        index,
        { effortLevels: undefined, defaultEffortLevel: undefined },
        { save: true },
      );
      if (!effortDetectionEnabled) {
        await updateSetting("gatewayServiceEffortDetection", true);
      }
    },
    [effortDetectionEnabled, updateService, updateSetting],
  );

  /**
   * Switch this service to a stated list, seeded with something real.
   *
   * The endpoint is asked first so the ticks start from what it actually
   * accepts and the user trims rather than guesses. An endpoint that says
   * nothing leaves every level YA names ticked, which is a starting point to
   * cut down — and it keeps the mode honest, since an empty list would snap
   * the radio straight back to asking.
   */
  const chooseStatedEffort = useCallback(
    async (index: number) => {
      if (await detectEffort(index)) return;
      updateService(
        index,
        {
          effortLevels: [...EFFORT_LEVEL_ORDER],
          defaultEffortLevel: undefined,
        },
        { save: true },
      );
    },
    [detectEffort, updateService],
  );

  return (
    <div id="provider-gateway-services" className="settings-subsection">
      <h3>{t("providersGatewayServicesTitle")}</h3>
      <p className="settings-hint">
        {t("providersGatewayServicesDescription")}
      </p>
      {/* What allowing a service means, and what CodexOSS falls back to when
          none is allowed: both are facts about the list rather than about any
          one entry, so they are stated once here instead of being repeated
          under every card's CodexOSS checkbox. */}
      <p className="settings-hint">{t("providersGatewayServicesCodexHint")}</p>
      {services.length > 1 && (
        <p className="settings-hint">{t("providersGatewayServiceOrderHint")}</p>
      )}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={exportEnabled}
          onChange={(event) =>
            void updateSetting(
              "gatewayServiceExportEnabled",
              event.target.checked,
            )
          }
        />{" "}
        <strong>{t("providersGatewayServiceExportTitle")}</strong>
      </label>
      <p className="settings-hint">
        {t("providersGatewayServiceExportDescription")}
      </p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={effortDetectionEnabled}
          onChange={(event) =>
            void updateSetting(
              "gatewayServiceEffortDetection",
              event.target.checked,
            )
          }
        />{" "}
        <strong>{t("providersGatewayServiceEffortDetectionTitle")}</strong>
      </label>
      <p className="settings-hint">
        {t("providersGatewayServiceEffortDetectionDescription")}
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          // Nothing here needs submitting — every field saves itself on blur —
          // but Enter in a text field would otherwise reload the page.
          event.preventDefault();
          void save();
        }}
      >
        {services.map((service, index) => {
          const loopback = isLoopbackGatewayUrl(service.url);
          const detection = detections[service.id];
          // A stated list is exactly what makes this service's own levels
          // authoritative, so the radio reads off the list rather than out of
          // a separate stored mode that could disagree with it.
          const statesEffortLevels = !!service.effortLevels?.length;
          const invocations =
            exportEnabled && exportPaths && service.enabled
              ? gatewayServiceCliInvocations(service, exportPaths)
              : undefined;
          return (
            <fieldset className={styles.card} key={service.id}>
              <legend className={styles.legend}>
                <input
                  type="text"
                  className={`settings-input ${styles.id}`}
                  value={service.id}
                  maxLength={32}
                  onChange={(event) =>
                    updateService(index, {
                      id: event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/gu, "-"),
                    })
                  }
                  onBlur={() => void save()}
                  aria-label={t("providersGatewayServiceIdAria")}
                />
                <span className={styles.reorder}>
                  <button
                    type="button"
                    disabled={index === 0}
                    title={t("providersGatewayServiceMoveUp")}
                    aria-label={t("providersGatewayServiceMoveUp")}
                    onClick={() => moveService(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === services.length - 1}
                    title={t("providersGatewayServiceMoveDown")}
                    aria-label={t("providersGatewayServiceMoveDown")}
                    onClick={() => moveService(index, 1)}
                  >
                    ↓
                  </button>
                </span>
              </legend>

              {/* The endpoint keeps its own row — a URL is the one long value
                  here — and the short fields after it pair off. Each hint sits
                  under its own field rather than as a full-width band between
                  rows, which is what made two services fill a phone screen. */}
              <label className={`${styles.field} ${styles.span2}`}>
                <span>{t("providersGatewayServiceUrlLabel")}</span>
                <input
                  type="url"
                  className="settings-input"
                  value={service.url}
                  placeholder={EXAMPLE_URL}
                  onChange={(event) =>
                    updateService(index, { url: event.target.value })
                  }
                  onBlur={() => void save()}
                  aria-label={t("providersGatewayServiceUrlAria")}
                />
              </label>

              <label className={styles.field}>
                <span>{t("providersGatewayServiceShortNameLabel")}</span>
                <input
                  type="text"
                  className="settings-input"
                  value={service.shortName}
                  maxLength={MAX_GATEWAY_SERVICE_SHORT_NAME_LENGTH}
                  placeholder={service.id}
                  onChange={(event) =>
                    updateService(index, {
                      shortName: event.target.value.trim(),
                    })
                  }
                  onBlur={() => void save()}
                  aria-label={t("providersGatewayServiceShortNameAria")}
                />
                <p className={styles.hint}>
                  {t("providersGatewayServiceShortNameHint")}
                </p>
              </label>

              {/* Not a full-width band: three short checkboxes wrap to about
                  the height of the short-name hint beside them, so they fill
                  the cell that hint would otherwise leave empty. */}
              <div className={styles.row}>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name="gateway-default-service"
                    checked={defaultId === service.id}
                    onChange={() => chooseDefault(service.id)}
                  />{" "}
                  {t("providersGatewayServiceDefault")}
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={service.enabled}
                    onChange={(event) =>
                      updateService(
                        index,
                        { enabled: event.target.checked },
                        { save: true },
                      )
                    }
                  />{" "}
                  {t("providersGatewayServiceEnabled")}
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={service.codexEnabled}
                    onChange={(event) =>
                      updateService(
                        index,
                        { codexEnabled: event.target.checked },
                        { save: true },
                      )
                    }
                  />{" "}
                  {t("providersGatewayServiceCodex")}
                </label>
              </div>

              <label className={styles.field}>
                <span>{t("providersGatewayServiceContextLabel")}</span>
                <input
                  type="number"
                  min={1}
                  className="settings-input"
                  value={numberFieldValue(service.contextWindowTokens)}
                  onChange={(event) =>
                    updateService(index, {
                      contextWindowTokens: parseNumberField(event.target.value),
                    })
                  }
                  onBlur={() => void save()}
                  aria-label={t("providersGatewayServiceContextAria")}
                />
              </label>
              <label className={styles.field}>
                <span>{t("providersGatewayServiceOutputLabel")}</span>
                <input
                  type="number"
                  min={1}
                  className="settings-input"
                  value={numberFieldValue(service.maxOutputTokens)}
                  onChange={(event) =>
                    updateService(index, {
                      maxOutputTokens: parseNumberField(event.target.value),
                    })
                  }
                  onBlur={() => void save()}
                  aria-label={t("providersGatewayServiceOutputAria")}
                />
              </label>
              <p className={`${styles.hint} ${styles.wide}`}>
                {t("providersGatewayServiceSizesHint")}
              </p>

              {invocations && (
                <div className={`${styles.commands} ${styles.wide}`}>
                  <span>{t("providersGatewayServiceCliLabel")}</span>
                  <code>{invocations.claude}</code>
                  {invocations.codex && <code>{invocations.codex}</code>}
                  <code>{invocations.pi}</code>
                </div>
              )}

              <details className={`${styles.advanced} ${styles.wide}`}>
                <summary>{t("providersGatewayServiceAdvanced")}</summary>
                <div className={styles.advancedBody}>
                  <label className={styles.field}>
                    <span>{t("providersGatewayServiceLabelLabel")}</span>
                    <input
                      type="text"
                      className="settings-input"
                      value={service.label}
                      maxLength={MAX_GATEWAY_SERVICE_LABEL_LENGTH}
                      onChange={(event) =>
                        updateService(index, {
                          label: event.target.value.trim(),
                        })
                      }
                      onBlur={() => void save()}
                      aria-label={t("providersGatewayServiceLabelAria")}
                    />
                  </label>

                  <label className={`${styles.field} ${styles.span2}`}>
                    <span>{t("providersGatewayServiceCommandLabel")}</span>
                    <input
                      type="text"
                      className="settings-input"
                      value={service.serviceCommand ?? ""}
                      maxLength={MAX_GATEWAY_SERVICE_COMMAND_LENGTH}
                      disabled={!loopback}
                      placeholder={t(
                        "providersGatewayServiceCommandPlaceholder",
                      )}
                      onChange={(event) =>
                        updateService(index, {
                          serviceCommand:
                            event.target.value.trim() || undefined,
                        })
                      }
                      onBlur={() => void save()}
                      aria-label={t("providersGatewayServiceCommandAria")}
                    />
                    <p className={styles.hint}>
                      {loopback
                        ? t("providersGatewayServiceCommandHint")
                        : t("providersGatewayServiceCommandRemoteHint")}
                    </p>
                  </label>

                  <div className={`${styles.row} ${styles.wide}`}>
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={service.autoStop}
                        disabled={!loopback || !service.serviceCommand}
                        onChange={(event) =>
                          updateService(
                            index,
                            { autoStop: event.target.checked },
                            { save: true },
                          )
                        }
                      />{" "}
                      {t("providersGatewayServiceAutoStop")}
                    </label>
                    <label className={`${styles.field} ${styles.inline}`}>
                      <span>{t("providersGatewayServiceAutoStopAfter")}</span>
                      <input
                        type="number"
                        min={0}
                        className="settings-input"
                        value={service.autoStopAfterSeconds}
                        disabled={!service.autoStop}
                        onChange={(event) =>
                          updateService(index, {
                            autoStopAfterSeconds:
                              parseNumberField(event.target.value) ?? 0,
                          })
                        }
                        onBlur={() => void save()}
                        aria-label={t(
                          "providersGatewayServiceAutoStopAfterAria",
                        )}
                      />
                    </label>
                    <p className={styles.hint}>
                      {t("providersGatewayServiceAutoStopHint")}
                    </p>
                  </div>

                  <label className={styles.field}>
                    <span>{t("providersGatewayServiceMaxModelsLabel")}</span>
                    <input
                      type="number"
                      min={1}
                      className="settings-input"
                      value={numberFieldValue(service.maxModels)}
                      onChange={(event) =>
                        updateService(index, {
                          maxModels: parseNumberField(event.target.value),
                        })
                      }
                      onBlur={() => void save()}
                      aria-label={t("providersGatewayServiceMaxModelsAria")}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>{t("providersGatewayServiceWireApiLabel")}</span>
                    <select
                      className="settings-input"
                      value={service.codexWireApi}
                      onChange={(event) =>
                        updateService(
                          index,
                          {
                            codexWireApi:
                              event.target.value === "responses"
                                ? "responses"
                                : "chat",
                          },
                          { save: true },
                        )
                      }
                      aria-label={t("providersGatewayServiceWireApiLabel")}
                    >
                      <option value="chat">chat/completions</option>
                      <option value="responses">responses</option>
                    </select>
                  </label>

                  <div className={`${styles.field} ${styles.wide}`}>
                    <span>{t("providersGatewayServiceEffortLabel")}</span>
                    <div className={styles.row}>
                      <label className={styles.check}>
                        <input
                          type="radio"
                          name={`gateway-effort-mode-${service.id}`}
                          checked={!statesEffortLevels}
                          onChange={() => void chooseAskedEffort(index)}
                        />{" "}
                        {t("providersGatewayServiceEffortModeAsk")}
                      </label>
                      <label className={styles.check}>
                        <input
                          type="radio"
                          name={`gateway-effort-mode-${service.id}`}
                          checked={statesEffortLevels}
                          onChange={() => void chooseStatedEffort(index)}
                        />{" "}
                        {t("providersGatewayServiceEffortModeStated")}
                      </label>
                    </div>
                    <div className={styles.row}>
                      {EFFORT_LEVEL_ORDER.map((level) => (
                        <label className={styles.check} key={level}>
                          <input
                            type="checkbox"
                            // Greyed out under "ask": the ticks are what "stated"
                            // means, so an editable tick there would be a second
                            // way to say the opposite of the chosen mode.
                            disabled={!statesEffortLevels}
                            checked={
                              service.effortLevels?.includes(level) ?? false
                            }
                            onChange={(event) =>
                              updateService(
                                index,
                                toggledEffortLevel(service, level, {
                                  checked: event.target.checked,
                                }),
                                { save: true },
                              )
                            }
                          />{" "}
                          {level}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className={styles.field}>
                    <span>
                      {t("providersGatewayServiceEffortDefaultLabel")}
                    </span>
                    <select
                      className="settings-input"
                      value={service.defaultEffortLevel ?? ""}
                      disabled={!service.effortLevels?.length}
                      onChange={(event) =>
                        updateService(
                          index,
                          {
                            defaultEffortLevel: isEffortLevel(
                              event.target.value,
                            )
                              ? event.target.value
                              : undefined,
                          },
                          { save: true },
                        )
                      }
                      aria-label={t(
                        "providersGatewayServiceEffortDefaultLabel",
                      )}
                    >
                      <option value="">
                        {t("providersGatewayServiceEffortDefaultUnknown")}
                      </option>
                      {(service.effortLevels ?? []).map((level) => (
                        <option value={level} key={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                  {detection && (
                    <p className={`${styles.hint} ${styles.wide}`}>
                      {detection.state === "asking"
                        ? t("providersGatewayServiceEffortDetecting")
                        : detection.state === "answered"
                          ? t("providersGatewayServiceEffortDetected", {
                              model: detection.modelId,
                              levels: detection.levels.join(", "),
                            })
                          : t(
                              EFFORT_DETECTION_FAILURE_MESSAGES[
                                detection.reason
                              ],
                            )}
                    </p>
                  )}
                  <p className={`${styles.hint} ${styles.wide}`}>
                    {t("providersGatewayServiceEffortHint")}
                  </p>

                  <label className={styles.field}>
                    <span>{t("providersGatewayServiceDisableAgentLabel")}</span>
                    <select
                      className="settings-input"
                      value={overrideValue(service.disableAgent)}
                      onChange={(event) =>
                        updateService(
                          index,
                          {
                            disableAgent:
                              event.target.value === "inherit"
                                ? undefined
                                : event.target.value === "on",
                          },
                          { save: true },
                        )
                      }
                      aria-label={t("providersGatewayServiceDisableAgentLabel")}
                    >
                      <option value="inherit">
                        {t("providersGatewayServiceOverrideInherit")}
                      </option>
                      <option value="on">
                        {t("providersGatewayServiceOverrideOn")}
                      </option>
                      <option value="off">
                        {t("providersGatewayServiceOverrideOff")}
                      </option>
                    </select>
                  </label>

                  <label className={styles.field}>
                    <span>
                      {t("providersGatewayServiceDisablePlanModeLabel")}
                    </span>
                    <select
                      className="settings-input"
                      value={overrideValue(service.disablePlanMode)}
                      onChange={(event) =>
                        updateService(
                          index,
                          {
                            disablePlanMode:
                              event.target.value === "inherit"
                                ? undefined
                                : event.target.value === "on",
                          },
                          { save: true },
                        )
                      }
                      aria-label={t(
                        "providersGatewayServiceDisablePlanModeLabel",
                      )}
                    >
                      <option value="inherit">
                        {t("providersGatewayServiceOverrideInherit")}
                      </option>
                      <option value="on">
                        {t("providersGatewayServiceOverrideOn")}
                      </option>
                      <option value="off">
                        {t("providersGatewayServiceOverrideOff")}
                      </option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className="settings-button"
                    onClick={() =>
                      replaceServices(
                        draft.current.services.filter(
                          (_, position) => position !== index,
                        ),
                      )
                    }
                  >
                    {t("providersGatewayServiceRemove")}
                  </button>
                </div>
              </details>
            </fieldset>
          );
        })}

        <div className={styles.actions}>
          <button
            type="button"
            className="settings-button"
            disabled={services.length >= MAX_GATEWAY_SERVICES}
            onClick={() =>
              replaceServices([
                ...draft.current.services,
                newService(
                  new Set(draft.current.services.map((service) => service.id)),
                ),
              ])
            }
          >
            {t("providersGatewayServiceAdd")}
          </button>
          {/* Each field writes itself when it loses focus, so this reports
              rather than commands: a Save button at the foot of a list this
              tall is scrolled out of sight exactly when it matters. */}
          <span className={styles.status} aria-live="polite">
            {isSaving
              ? t("providersSaving")
              : hasChanges
                ? t("providersGatewayServicePendingBlur")
                : t("providersGatewayServiceAutoSaved")}
          </span>
        </div>
        <p className={styles.hint}>
          {t("providersClaudeGatewayIsolationHint")}
        </p>
      </form>
    </div>
  );
}
