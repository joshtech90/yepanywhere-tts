/**
 * Grok's x.ai/interject drain wraps the user's text in a synthetic envelope
 * before writing it back as a user_message_chunk. YA already echoed the
 * raw steer; replay must show that inner text, not the wrapper.
 *
 * Match the outer envelope only. A steer that quotes another <user_query>
 * block keeps that inner markup. Two in-flight interjects may arrive as
 * consecutive user_message_chunk updates or as one chunk with concatenated
 * envelopes (sometimes with the first opening or last closing omitted).
 * Split those into one inner text per send so each can confirm its
 * optimistic echo.
 */

const INTERJECT_PREFIX_SOURCE =
  "The user sent a message while you were working:\\r?\\n<user_query>\\r?\\n";
const INTERJECT_SUFFIX_SOURCE =
  "\\r?\\n<\\/user_query>\\r?\\nMake sure to complete any unfinished tasks from previous turns\\.\\s*";

const INTERJECT_PREFIX_AT_START = new RegExp(`^${INTERJECT_PREFIX_SOURCE}`);
const INTERJECT_PREFIX_ANYWHERE = new RegExp(INTERJECT_PREFIX_SOURCE);
const INTERJECT_SUFFIX_AT_END = new RegExp(`${INTERJECT_SUFFIX_SOURCE}$`);

/**
 * Grok's ACP `x.ai/interject` success is
 * `{ result: { status: "queued" } }` (`ExtMethodResult`). A bare
 * `{ status: "queued" }` is also accepted. Checking only the outer
 * `status` treats a successful interject as a failed steer, so YA also
 * pushes the same text into MessageQueue and later concatenates it into
 * a second `session/prompt`.
 */
export function grokInterjectAccepted(
  result: Record<string, unknown> | null | undefined,
): boolean {
  if (!result) return false;
  if (result.status === "queued") return true;
  const inner = result.result;
  return (
    !!inner &&
    typeof inner === "object" &&
    !Array.isArray(inner) &&
    (inner as { status?: unknown }).status === "queued"
  );
}

export function unwrapGrokInterjectText(text: string): string {
  const prefix = text.match(INTERJECT_PREFIX_AT_START);
  if (prefix?.index !== 0) return text;
  const suffix = text.match(INTERJECT_SUFFIX_AT_END);
  if (!suffix) return text;
  const start = prefix[0].length;
  const end = text.length - suffix[0].length;
  if (end < start) return text;
  return text.slice(start, end);
}

function stripTrailingInterjectSuffix(text: string): string {
  const suffix = text.match(INTERJECT_SUFFIX_AT_END);
  return suffix ? text.slice(0, text.length - suffix[0].length) : text;
}

function findClosingSuffix(
  afterPrefix: string,
): { index: number; length: number } | null {
  for (const match of afterPrefix.matchAll(
    new RegExp(INTERJECT_SUFFIX_SOURCE, "g"),
  )) {
    if (match.index === undefined) continue;
    const after = afterPrefix.slice(match.index + match[0].length);
    if (after.length === 0 || INTERJECT_PREFIX_AT_START.test(after)) {
      return { index: match.index, length: match[0].length };
    }
  }
  return null;
}

/**
 * One inner user-turn text per Grok envelope in `text`.
 *
 * A quoted `<user_query>` that is not wrapped in Grok's "while you were
 * working" / "Make sure to complete…" boilerplate stays inside its send.
 */
export function splitGrokUserMessageTexts(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    const prefixMatch = rest.match(INTERJECT_PREFIX_ANYWHERE);
    if (!prefixMatch || prefixMatch.index === undefined) {
      const leading = stripTrailingInterjectSuffix(rest);
      if (leading.trim()) parts.push(leading);
      break;
    }

    if (prefixMatch.index > 0) {
      const leadingRaw = rest.slice(0, prefixMatch.index);
      // A PREFIX that is not immediately after a real envelope suffix is
      // quoted user text, not another Grok drain.
      if (!INTERJECT_SUFFIX_AT_END.test(leadingRaw)) {
        const leading = stripTrailingInterjectSuffix(rest);
        if (leading.trim()) parts.push(leading);
        break;
      }
      const leading = stripTrailingInterjectSuffix(leadingRaw);
      if (leading.trim()) parts.push(leading);
      rest = rest.slice(prefixMatch.index);
      continue;
    }

    const afterPrefix = rest.slice(prefixMatch[0].length);
    const suffix = findClosingSuffix(afterPrefix);
    if (!suffix) {
      if (afterPrefix.trim()) parts.push(afterPrefix);
      break;
    }
    parts.push(afterPrefix.slice(0, suffix.index));
    rest = afterPrefix.slice(suffix.index + suffix.length);
  }

  if (parts.length === 0) {
    return text.trim() ? [text] : [];
  }
  return parts;
}
