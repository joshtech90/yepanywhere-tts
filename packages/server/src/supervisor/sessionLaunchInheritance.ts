import {
  type EffortLevel,
  type PermissionMode,
  type ThinkingConfig,
  type ThinkingOption,
  thinkingOptionToConfig,
} from "@yep-anywhere/shared";
import type { EffectiveSessionLaunchSettingsValue } from "../metadata/index.js";

/**
 * Settings a successor session is explicitly asked to launch with. An
 * undefined field inherits the source's; a null service tier asks for the
 * provider default.
 */
export interface SuccessorLaunchOverrides {
  requestedModel?: string;
  thinking?: ThinkingOption;
  serviceTier?: string | null;
  permissionMode?: PermissionMode;
}

export interface SuccessorLaunchSettings {
  requestedModel: string | undefined;
  thinking: ThinkingConfig | undefined;
  effort: EffortLevel | undefined;
  serviceTier: string | undefined;
  permissionMode: PermissionMode | undefined;
}

/**
 * Successor launch inheritance: the launch settings a restart, handoff, or
 * fork starts with. Each explicit override wins. Otherwise the model,
 * thinking, effort, and service tier come from the source's recorded launch
 * settings only when the successor keeps the source's provider (falling back
 * to the source's legacy requested model), while the permission mode is
 * inherited across providers.
 */
export function inheritSuccessorLaunchSettings(
  source: EffectiveSessionLaunchSettingsValue | undefined,
  inheritance: {
    sameProvider: boolean;
    /** Read only when neither an override nor the source names a model. */
    legacyRequestedModel?: () => string | undefined;
  },
  overrides: SuccessorLaunchOverrides,
): SuccessorLaunchSettings {
  const providerSource = inheritance.sameProvider ? source : undefined;
  const thinking =
    overrides.thinking !== undefined
      ? thinkingOptionToConfig(overrides.thinking)
      : {
          thinking: providerSource?.thinking ?? undefined,
          effort: providerSource?.effort ?? undefined,
        };
  return {
    requestedModel:
      overrides.requestedModel ??
      providerSource?.requestedModel ??
      (inheritance.sameProvider
        ? inheritance.legacyRequestedModel?.()
        : undefined),
    thinking: thinking.thinking,
    effort: thinking.effort,
    serviceTier:
      overrides.serviceTier !== undefined
        ? (overrides.serviceTier ?? undefined)
        : (providerSource?.serviceTier ?? undefined),
    permissionMode: overrides.permissionMode ?? source?.permissionMode,
  };
}
