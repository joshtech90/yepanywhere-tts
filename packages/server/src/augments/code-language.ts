/**
 * Reduce a fenced code block's info string to one comparable language name.
 *
 * CommonMark puts arbitrary text after the opening fence; only its first word
 * is conventionally a language, and the rest is renderer-specific attributes.
 * Every consumer — grammar lookup, the `ansi`/`toon` special cases, and the
 * `language-*` class the client dispatches on — must see the same form, so
 * this is the single place that trims, takes the first word, and lowercases.
 *
 * Returns undefined when the fence names no language.
 */
export function normalizeCodeBlockLanguage(
  language?: string,
): string | undefined {
  if (typeof language !== "string") {
    return undefined;
  }

  const trimmed = language.trim();
  if (trimmed === "") {
    return undefined;
  }

  const token = trimmed.split(/\s+/)[0];
  if (!token) {
    return undefined;
  }

  return token.toLowerCase();
}
