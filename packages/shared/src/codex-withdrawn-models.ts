/**
 * Codex models OpenAI has withdrawn: every turn on them fails, so YA never
 * offers one, whether from the live catalog, a discovery-failure fallback, an
 * upgrade target, or a saved new-session preference. A session already
 * recorded with one keeps its history; this list only stops new selections.
 */
export const CODEX_WITHDRAWN_MODEL_IDS: ReadonlySet<string> = new Set([
  "gpt-5.5",
  "gpt-5.3-codex-spark",
]);

export function isWithdrawnCodexModel(modelId: string): boolean {
  return CODEX_WITHDRAWN_MODEL_IDS.has(modelId);
}
