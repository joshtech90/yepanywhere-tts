/**
 * Compact context-window label. Providers quote windows in decimal units
 * (200K, 1M), so dividing by 1024 would show a 1M window as "977K".
 */
export function formatContextWindowLabel(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${Number((tokens / 1_000_000).toFixed(1))}M ctx`;
  }
  return `${Math.round(tokens / 1000)}K ctx`;
}
