import { isRecord } from "./plain-record.js";
import { effortOfThinkingOption } from "./turn-effort.js";
import {
  ALL_PROVIDERS,
  type ProviderName,
  type ThinkingOption,
} from "./types.js";

/**
 * Long-context effort-change warning: before a mid-session effort change on a
 * session whose prompt is already large, YA warns that the change re-reads
 * that whole prompt (the providers below cache the prompt per effort, so no
 * cached prefix matches) and offers a fork instead. Contract:
 * topics/mid-session-effort-change.md.
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
 * Providers whose effort change is known to miss the prompt cache: Claude
 * (the cache is keyed by effort; measured in
 * topics/mid-session-effort-change.evidence.md) and Codex (request-level
 * reasoning effort; see gaps/codex-cache-features.md for the Astra exception
 * that is not yet usable).
 */
export const DEFAULT_LONG_CONTEXT_EFFORT_WARNING_SETTINGS: LongContextEffortWarningSettings =
  {
    providers: { claude: true, codex: true },
    thresholdTokens: DEFAULT_LONG_CONTEXT_EFFORT_WARNING_TOKENS,
  };

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
 * Concrete Claude model ids whose prompt cache survives an effort change,
 * each confirmed by a warm-session measurement recorded in
 * topics/mid-session-effort-change.evidence.md. A bare alias such as `opus`
 * is not listed: it can resolve to a later version that has not been
 * measured.
 */
const CLAUDE_EFFORT_CACHE_SAFE_MODELS: readonly string[] = ["claude-opus-5-5"];

/** Strips the extended-context and dated-snapshot suffixes of a Claude id. */
function baseClaudeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/-\d{8}$/, "");
}

/**
 * Whether a mid-session effort change on this provider and model keeps the
 * provider's prompt cache. On Claude, Opus 5.5 does; Sonnet 5 was measured
 * not to. Codex's `configuration_update` path for GPT-6 Astra exists in the
 * pinned source but is behind a default-off Codex feature YA does not enable
 * (gaps/codex-cache-features.md). Flip the Astra branch once that is enabled
 * and a warm-session measurement confirms the cache survives.
 */
export function effortChangeKeepsPromptCache(
  provider: ProviderName,
  model: string | undefined,
): boolean {
  if (provider !== "claude" || !model) return false;
  return CLAUDE_EFFORT_CACHE_SAFE_MODELS.includes(baseClaudeModelId(model));
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
