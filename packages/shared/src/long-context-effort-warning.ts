import {
  ALL_PROVIDERS,
  type ProviderName,
  type ThinkingOption,
} from "./types.js";

/**
 * Long-context effort-change warning: before a mid-session effort change on a
 * session whose prompt is already large, YA warns that the change re-reads
 * most of that prompt (the effort is part of the rendered system prompt on
 * the providers below, so the cached prefix no longer matches) and offers a
 * fork instead. Contract: topics/mid-session-effort-change.md.
 */
export type LongContextEffortWarningSettings = {
  /** Per-provider enablement. Absent or false means no warning. */
  providers?: Partial<Record<ProviderName, boolean>>;
  /**
   * Prompt size, in tokens, at or above which a session counts as long
   * context. 0 warns on every effort change.
   */
  thresholdTokens?: number;
};

export const DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS = 5_000;
/** Slider ceiling; the exact numeric input accepts any non-negative integer. */
export const LONG_CONTEXT_EFFORT_WARNING_SLIDER_MAX_TOKENS = 500_000;
export const LONG_CONTEXT_EFFORT_WARNING_SLIDER_STEP_TOKENS = 1_000;

/**
 * Providers whose effort change is known to re-render the system prompt:
 * Claude (user-observed cache loss on effort change) and Codex (request-level
 * reasoning effort; see gaps/codex-cache-features.md for the Astra exception
 * that is not yet usable).
 */
export const DEFAULT_LONG_CONTEXT_EFFORT_WARNING_SETTINGS: LongContextEffortWarningSettings =
  {
    providers: { claude: true, codex: true },
    thresholdTokens: DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS,
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a stored or submitted setting. `undefined`/`null`/`""` yields the
 * defaults; a malformed object yields `null` so callers can reject it.
 */
export function parseLongContextEffortWarningSettings(
  raw: unknown,
): LongContextEffortWarningSettings | null {
  if (raw === undefined || raw === null || raw === "") {
    return {
      providers: { ...DEFAULT_LONG_CONTEXT_EFFORT_WARNING_SETTINGS.providers },
      thresholdTokens: DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS,
    };
  }
  if (!isRecord(raw)) return null;

  const providers: Partial<Record<ProviderName, boolean>> = {};
  if (
    "providers" in raw &&
    raw.providers !== undefined &&
    raw.providers !== null
  ) {
    if (!isRecord(raw.providers)) return null;
    for (const [name, enabled] of Object.entries(raw.providers)) {
      if (!ALL_PROVIDERS.includes(name as ProviderName)) return null;
      if (enabled === undefined || enabled === null) continue;
      if (typeof enabled !== "boolean") return null;
      if (enabled) providers[name as ProviderName] = true;
    }
  }

  let thresholdTokens = DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS;
  if ("thresholdTokens" in raw && raw.thresholdTokens !== undefined) {
    if (
      typeof raw.thresholdTokens !== "number" ||
      !Number.isInteger(raw.thresholdTokens) ||
      raw.thresholdTokens < 0
    ) {
      return null;
    }
    thresholdTokens = raw.thresholdTokens;
  }

  return { providers, thresholdTokens };
}

/**
 * The effort a thinking option asks for, or `undefined` when the option lets
 * the provider choose (`auto`) or disables thinking (`off`). Two options with
 * different results here are an effort change for the warning's purposes.
 */
export function effortOfThinkingOption(
  option: ThinkingOption | undefined,
): string | undefined {
  if (option === undefined || option === "off" || option === "auto") {
    return undefined;
  }
  return option.startsWith("on:") ? option.slice(3) : option;
}

/**
 * Whether a mid-session effort change on this provider and model keeps the
 * provider's prompt cache. Today no wired provider does: Codex's
 * `configuration_update` path for GPT-6 Astra exists in the pinned source but
 * is behind a default-off Codex feature YA does not enable
 * (gaps/codex-cache-features.md). Flip the Astra branch once that is enabled
 * and a warm-session measurement confirms the cache survives.
 */
export function effortChangeKeepsPromptCache(
  _provider: ProviderName,
  _model: string | undefined,
): boolean {
  return false;
}

export interface LongContextEffortChangeQuery {
  provider: ProviderName | undefined;
  model: string | undefined;
  /** Prompt size of the session's last provider request, in tokens. */
  contextTokens: number | undefined;
  currentThinking: ThinkingOption | undefined;
  nextThinking: ThinkingOption;
  settings: LongContextEffortWarningSettings | null | undefined;
}

/**
 * Whether the warning should interrupt this effort change. Requires the
 * provider to be enabled in settings, an effort component that actually
 * changes, a known prompt size at or above the threshold, and no cache-safe
 * mechanism for the provider/model pair.
 */
export function shouldWarnLongContextEffortChange(
  query: LongContextEffortChangeQuery,
): boolean {
  const { provider, settings } = query;
  if (!provider || settings?.providers?.[provider] !== true) return false;
  if (
    effortOfThinkingOption(query.currentThinking) ===
    effortOfThinkingOption(query.nextThinking)
  ) {
    return false;
  }
  if (query.contextTokens === undefined || query.contextTokens <= 0) {
    return false;
  }
  const threshold =
    settings.thresholdTokens ?? DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS;
  if (query.contextTokens < threshold) return false;
  return !effortChangeKeepsPromptCache(provider, query.model);
}
