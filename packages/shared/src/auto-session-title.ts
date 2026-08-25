/**
 * Automatic session titles.
 *
 * A session's default title is the first user message, truncated. That reads
 * fine inside one session but makes the session list hard to scan: many rows
 * start with the same boilerplate, and the topic is often past the cutoff.
 *
 * This feature asks a cheap helper model (Haiku for Claude, a mini model for
 * Codex) to name a session once, shortly after it starts, and stores the
 * result as the session's custom title. It never touches the provider
 * transcript, and it never overwrites a title the user set themselves.
 *
 * See topics/auto-session-title.md.
 */

import { sanitizeSessionTitle } from "./session/SessionView.js";

/** Shortest accepted `maxLength`. Below this, titles stop being descriptive. */
export const AUTO_SESSION_TITLE_MIN_LENGTH = 16;
/** Longest accepted `maxLength`. Matches the retitle route's upper bound. */
export const AUTO_SESSION_TITLE_MAX_LENGTH = 132;
export const DEFAULT_AUTO_SESSION_TITLE_MAX_LENGTH = 48;

/** Bounds for how many messages must exist before a session is titled. */
export const AUTO_SESSION_TITLE_MIN_TRIGGER_MESSAGES = 1;
export const AUTO_SESSION_TITLE_MAX_TRIGGER_MESSAGES = 20;
/**
 * Default: wait for the first user turn plus the first assistant reply. The
 * reply disambiguates terse openers ("mach mal weiter", a bare URL) that the
 * user message alone cannot.
 */
export const DEFAULT_AUTO_SESSION_TITLE_TRIGGER_MESSAGES = 2;

/** Bounds for the settle delay after the triggering message count is reached. */
export const AUTO_SESSION_TITLE_MIN_DELAY_SECONDS = 0;
export const AUTO_SESSION_TITLE_MAX_DELAY_SECONDS = 600;
export const DEFAULT_AUTO_SESSION_TITLE_DELAY_SECONDS = 20;

/** Language the generated title should be written in. */
export const AUTO_SESSION_TITLE_LANGUAGES = ["auto", "de", "en"] as const;
export type AutoSessionTitleLanguage =
  (typeof AUTO_SESSION_TITLE_LANGUAGES)[number];

export interface AutoSessionTitleSettings {
  /** Master switch. When false the service never runs. */
  enabled: boolean;
  /** Conversation messages required before a title is generated. */
  triggerMessageCount: number;
  /**
   * Seconds to wait after the trigger is reached before generating, so a
   * fast-moving session is titled from a slightly richer opening.
   */
  delaySeconds: number;
  /** Target maximum length of the generated title, in characters. */
  maxLength: number;
  /** `auto` mirrors the user's own language; `de`/`en` force one. */
  language: AutoSessionTitleLanguage;
  /**
   * Also title sessions that already existed when the server started. Off by
   * default so enabling the feature does not fan out over the whole history.
   */
  backfillExisting: boolean;
}

export const DEFAULT_AUTO_SESSION_TITLE_SETTINGS: AutoSessionTitleSettings = {
  enabled: false,
  triggerMessageCount: DEFAULT_AUTO_SESSION_TITLE_TRIGGER_MESSAGES,
  delaySeconds: DEFAULT_AUTO_SESSION_TITLE_DELAY_SECONDS,
  maxLength: DEFAULT_AUTO_SESSION_TITLE_MAX_LENGTH,
  language: "auto",
  backfillExisting: false,
};

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function isAutoSessionTitleLanguage(
  value: unknown,
): value is AutoSessionTitleLanguage {
  return (
    typeof value === "string" &&
    (AUTO_SESSION_TITLE_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Coerce partial/untrusted input (settings file, PUT body) into a complete,
 * in-range settings object. Never throws — out-of-range fields fall back to
 * the default rather than rejecting the whole object.
 */
export function normalizeAutoSessionTitleSettings(
  value: unknown,
  base: AutoSessionTitleSettings = DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
): AutoSessionTitleSettings {
  const input = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof AutoSessionTitleSettings, unknown>
  >;

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : base.enabled,
    triggerMessageCount: clampInteger(
      input.triggerMessageCount,
      AUTO_SESSION_TITLE_MIN_TRIGGER_MESSAGES,
      AUTO_SESSION_TITLE_MAX_TRIGGER_MESSAGES,
      base.triggerMessageCount,
    ),
    delaySeconds: clampInteger(
      input.delaySeconds,
      AUTO_SESSION_TITLE_MIN_DELAY_SECONDS,
      AUTO_SESSION_TITLE_MAX_DELAY_SECONDS,
      base.delaySeconds,
    ),
    maxLength: clampInteger(
      input.maxLength,
      AUTO_SESSION_TITLE_MIN_LENGTH,
      AUTO_SESSION_TITLE_MAX_LENGTH,
      base.maxLength,
    ),
    language: isAutoSessionTitleLanguage(input.language)
      ? input.language
      : base.language,
    backfillExisting:
      typeof input.backfillExisting === "boolean"
        ? input.backfillExisting
        : base.backfillExisting,
  };
}

const LEADING_LABEL_RE = /^(?:title|titel)\s*[:\-–—]\s*/iu;
const SURROUNDING_QUOTES_RE = /^["'`“”‘’«»]+|["'`“”‘’«»]+$/gu;
const MARKDOWN_NOISE_RE = /^[#>*\-\s]+/u;
const TRAILING_PUNCTUATION_RE = /[.!?,;:]+$/u;

/**
 * Turn raw helper-model output into a storable title.
 *
 * Helper models sometimes answer with a preamble line, wrap the title in
 * quotes, or prefix it with `Title:` despite the instruction not to. Take the
 * first non-empty line and strip those wrappers. Returns undefined when
 * nothing usable is left, so the caller can leave the title alone rather than
 * store an empty or junk value.
 */
export function normalizeGeneratedSessionTitle(
  raw: string,
  maxLength: number = DEFAULT_AUTO_SESSION_TITLE_MAX_LENGTH,
): string | undefined {
  const firstLine = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;

  // Strip wrappers repeatedly: `Title: "Telegram-Bot Deploy".` needs the
  // trailing period gone before the closing quote becomes strippable, and a
  // single pass in either order leaves one of them behind.
  let stripped = firstLine.replace(MARKDOWN_NOISE_RE, "");
  for (let pass = 0; pass < 4; pass += 1) {
    const next = stripped
      .replace(LEADING_LABEL_RE, "")
      .replace(SURROUNDING_QUOTES_RE, "")
      .replace(TRAILING_PUNCTUATION_RE, "")
      .trim();
    if (next === stripped) break;
    stripped = next;
  }

  const cleaned = sanitizeSessionTitle(stripped);
  if (!cleaned) return undefined;

  const limit = clampInteger(
    maxLength,
    AUTO_SESSION_TITLE_MIN_LENGTH,
    AUTO_SESSION_TITLE_MAX_LENGTH,
    DEFAULT_AUTO_SESSION_TITLE_MAX_LENGTH,
  );
  if (cleaned.length <= limit) return cleaned;

  // Prefer cutting at a word boundary so a clipped title still reads as words.
  const hardCut = cleaned.slice(0, limit);
  const lastSpace = hardCut.lastIndexOf(" ");
  const trimmed = (
    lastSpace >= Math.floor(limit * 0.6) ? hardCut.slice(0, lastSpace) : hardCut
  ).trimEnd();
  return trimmed || hardCut.trimEnd();
}
