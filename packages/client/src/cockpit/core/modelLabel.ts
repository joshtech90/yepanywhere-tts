/**
 * The model name for the narrow header chip: the provider prefix and a
 * trailing release date say nothing on a phone ("claude-opus-5-5" became
 * "claude-opus-5…", Joscha 26.09.2026).
 */
export function shortCockpitModelLabel(model: string): string {
  const short = model
    .trim()
    .replace(/^claude-/i, "")
    .replace(/-\d{8}$/, "");
  return short || model;
}
