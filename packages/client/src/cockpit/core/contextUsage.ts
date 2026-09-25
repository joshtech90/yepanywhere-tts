import type { ContextUsage } from "@yep-anywhere/shared";

export interface CockpitContextUsageView {
  /** Null when YA's window is evidently too small for the tokens in use. */
  percent: number | null;
  used: string;
  short: string;
  window: string;
}

/**
 * Context use for the session header. YA sometimes assumes a 200k window for
 * a model that has more, which yields values above 100 %; then only the
 * token count is shown, never a percentage that cannot be right.
 */
export function cockpitContextUsage(
  usage: ContextUsage | undefined,
  locale: string,
): CockpitContextUsageView | null {
  if (!usage || !Number.isFinite(usage.inputTokens) || usage.inputTokens <= 0) {
    return null;
  }
  const windowKnown =
    typeof usage.contextWindow === "number" &&
    usage.contextWindow >= usage.inputTokens;
  const percent =
    windowKnown && Number.isFinite(usage.percentage)
      ? Math.min(100, Math.round(usage.percentage))
      : null;
  return {
    percent,
    used: usage.inputTokens.toLocaleString(locale),
    short: `${Math.round(usage.inputTokens / 1000)}k`,
    window: usage.contextWindow ? usage.contextWindow.toLocaleString(locale) : "?",
  };
}
