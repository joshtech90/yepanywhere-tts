import type { EffortLevel, ModelInfo, ThinkingOption } from "./types.js";

export const EFFORT_LEVEL_ORDER: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export type TurnEffort = "fast" | "slow" | "fastest" | "slowest";

export function isTurnEffort(value: unknown): value is TurnEffort {
  return (
    value === "fast" ||
    value === "slow" ||
    value === "fastest" ||
    value === "slowest"
  );
}

export function getModelEffortLevels(model?: ModelInfo): EffortLevel[] {
  if (model?.supportsEffort === false) return [];
  const supported =
    model?.supportedReasoningEfforts?.map(({ reasoningEffort }) =>
      reasoningEffort === "ultra" ? "max" : reasoningEffort,
    ) ??
    model?.supportedEffortLevels ??
    [];
  return EFFORT_LEVEL_ORDER.filter((level) => supported.includes(level));
}

export function nativeModelEffort(
  level: EffortLevel,
  model?: ModelInfo,
): string {
  if (level !== "max") return level;
  const native =
    model?.supportedReasoningEfforts?.map(
      ({ reasoningEffort }) => reasoningEffort,
    ) ?? model?.supportedEffortLevels;
  if (!native?.length) return level;
  for (const maximum of ["ultra", "max", "xhigh", "high", "medium", "low"]) {
    if (native.includes(maximum)) return maximum;
  }
  throw new Error("The selected model has no supported maximum effort");
}

export function resolveTurnEffort(
  modifier: TurnEffort,
  normal: ThinkingOption,
  model: ModelInfo,
): ThinkingOption {
  if (modifier === "fastest") return "off";
  const levels = getModelEffortLevels(model);
  if (!levels.length)
    throw new Error("The selected model does not advertise effort levels");
  if (modifier === "slowest") return `on:${levels[levels.length - 1]!}`;
  if (normal === "off") return modifier === "fast" ? "off" : `on:${levels[0]!}`;
  const baseline =
    normal === "auto"
      ? (model.defaultReasoningEffort ?? model.defaultEffortLevel)
      : normal.replace(/^on:/, "");
  const index = levels.indexOf(
    (baseline === "ultra" ? "max" : baseline) as EffortLevel,
  );
  if (index < 0)
    throw new Error(
      "Select an explicit supported effort before using /fast or /slow",
    );
  const next = Math.max(
    0,
    Math.min(levels.length - 1, index + (modifier === "slow" ? 1 : -1)),
  );
  return `on:${levels[next]!}`;
}
