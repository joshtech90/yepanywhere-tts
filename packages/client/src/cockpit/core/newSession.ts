import type {
  EffortLevel,
  ModelInfo,
  NewSessionDefaults,
  PermissionMode,
  ProviderInfo,
  ProviderName,
  ThinkingMode,
} from "@yep-anywhere/shared";
import type { SessionOptions } from "../../api/client";
import {
  getEffortLevelOptions,
  getThinkingModeOptions,
  resolveSupportedEffortLevel,
  resolveSupportedThinkingMode,
  type EffortLevelOption,
  type EffortLevelTranslate,
} from "../../lib/effortLevels";
import {
  getPreferredProviderModelId,
  getProviderSessionDefaults,
  withProviderSessionDefaults,
} from "../../lib/newSessionDefaults";
import { toThinkingOption } from "../../lib/newSessionOptions";
import { getPermissionModeOptions } from "../../lib/permissionModes";

/** What the Cockpit asks for when it launches a session. */
export interface CockpitLaunchSelection {
  provider: ProviderName | null;
  model: string | null;
  thinkingMode: ThinkingMode;
  effortLevel: EffortLevel;
  permissionMode: PermissionMode;
}

/** Choices the current provider and model actually offer. */
export interface CockpitLaunchChoices {
  models: ModelInfo[];
  modelInfo: ModelInfo | null;
  effortOptions: EffortLevelOption[];
  thinkingModes: ThinkingMode[];
  permissionModes: PermissionMode[];
  supportsPermissionMode: boolean;
  supportsThinking: boolean;
  /** The selection with every value snapped to what is offered. */
  effective: CockpitLaunchSelection;
}

export interface CockpitLegacyThinking {
  thinkingMode: ThinkingMode;
  effortLevel: EffortLevel;
}

/** Providers YA can start: installed, auth is checked by the launch itself. */
export function launchableProviders(providers: ProviderInfo[]): ProviderInfo[] {
  return providers.filter((provider) => provider.installed && provider.enabled);
}

/**
 * Selection for one provider from the saved new-session defaults, which the
 * classic form keeps too, so both surfaces start from the same last choice.
 */
export function selectionForProvider(
  defaults: NewSessionDefaults | null | undefined,
  provider: ProviderInfo,
  legacy: CockpitLegacyThinking,
  permissionMode: PermissionMode,
): CockpitLaunchSelection {
  const scoped = getProviderSessionDefaults(defaults, provider.name, legacy);
  return {
    provider: provider.name,
    model: getPreferredProviderModelId(
      provider.name,
      provider.models ?? [],
      scoped.model,
    ),
    thinkingMode: scoped.thinkingMode ?? legacy.thinkingMode,
    effortLevel: scoped.effortLevel ?? legacy.effortLevel,
    permissionMode,
  };
}

export function initialLaunchSelection(
  defaults: NewSessionDefaults | null | undefined,
  providers: ProviderInfo[],
  legacy: CockpitLegacyThinking,
): CockpitLaunchSelection | null {
  const launchable = launchableProviders(providers);
  const provider =
    launchable.find((entry) => entry.name === defaults?.provider) ??
    launchable.find((entry) => entry.name === "claude") ??
    launchable[0];
  if (!provider) return null;
  return selectionForProvider(
    defaults,
    provider,
    legacy,
    defaults?.permissionMode ?? "default",
  );
}

export function launchChoices(
  selection: CockpitLaunchSelection,
  provider: ProviderInfo | undefined,
  translate?: EffortLevelTranslate,
): CockpitLaunchChoices {
  const models = provider?.models ?? [];
  const modelInfo = models.find((model) => model.id === selection.model) ?? null;
  const effortOptions = getEffortLevelOptions({
    provider: provider ?? selection.provider,
    model: modelInfo,
    translate,
  });
  const thinkingModes = getThinkingModeOptions({
    provider: provider ?? selection.provider,
    model: modelInfo,
    effortOptions,
  });
  const permissionModes = getPermissionModeOptions({ model: modelInfo });
  const supportsPermissionMode = provider?.supportsPermissionMode !== false;
  const supportsThinking =
    provider?.supportsThinkingToggle !== false &&
    thinkingModes.some((mode) => mode !== "off");
  return {
    models,
    modelInfo,
    effortOptions,
    thinkingModes,
    permissionModes,
    supportsPermissionMode,
    supportsThinking,
    effective: {
      ...selection,
      thinkingMode: resolveSupportedThinkingMode(
        selection.thinkingMode,
        thinkingModes,
      ),
      effortLevel: resolveSupportedEffortLevel(
        selection.effortLevel,
        effortOptions,
      ),
      permissionMode: permissionModes.includes(selection.permissionMode)
        ? selection.permissionMode
        : "default",
    },
  };
}

export function launchOptions(choices: CockpitLaunchChoices): SessionOptions {
  const { effective } = choices;
  return {
    provider: effective.provider ?? undefined,
    model: effective.model ?? undefined,
    thinking: choices.supportsThinking
      ? toThinkingOption(effective.thinkingMode, effective.effortLevel)
      : "off",
    ...(choices.supportsPermissionMode
      ? { mode: effective.permissionMode }
      : {}),
  };
}

/** Saved defaults after a successful launch: the next form starts from here. */
export function rememberLaunch(
  defaults: NewSessionDefaults | null | undefined,
  selection: CockpitLaunchSelection,
  legacy: CockpitLegacyThinking,
): NewSessionDefaults | null {
  if (!selection.provider) return null;
  return withProviderSessionDefaults(
    {
      ...defaults,
      provider: selection.provider,
      permissionMode: selection.permissionMode,
    },
    selection.provider,
    {
      model: selection.model ?? undefined,
      thinkingMode: selection.thinkingMode,
      effortLevel: selection.effortLevel,
    },
    legacy,
  );
}

/** A typed folder: `~` stays for the server to expand, trailing slashes go. */
export function normalizeProjectPath(input: string): string {
  const trimmed = input.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}
