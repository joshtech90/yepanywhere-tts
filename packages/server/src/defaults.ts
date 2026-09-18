// One hour matches the longest provider prompt-cache TTL YA requests, so a
// longer grace buys no warmth — only resident memory. Each idle harness costs
// roughly 80 MiB (Codex) to 215 MiB (Claude) of tree RSS.
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 60 * 60;
export const DEFAULT_IDLE_TIMEOUT_MS = DEFAULT_IDLE_TIMEOUT_SECONDS * 1000;
