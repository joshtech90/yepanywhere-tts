/**
 * Prompt shared by the side-session retitle helpers (Claude and Codex).
 *
 * Kept provider-neutral and in one place so both providers ask for the same
 * shape of title; only the model and transport differ.
 * See topics/auto-session-title.md.
 */

import { DEFAULT_AUTO_SESSION_TITLE_MAX_LENGTH } from "@yep-anywhere/shared";

export interface AutoTitlePromptOptions {
  /** Opening user/assistant turns, already bounded by the caller. */
  transcriptExcerpt: string;
  /** Current displayed title, if any, so the helper does not just echo it. */
  currentTitle?: string;
  /** Target maximum title length in characters. */
  lengthTarget?: number;
  /** `auto` mirrors the user's own language; `de`/`en` force one. */
  language?: "auto" | "de" | "en";
}

const LANGUAGE_INSTRUCTION: Record<"auto" | "de" | "en", string> = {
  auto: "Write the title in the same language the user writes in.",
  de: "Write the title in German.",
  en: "Write the title in English.",
};

/** Upper bound on excerpt characters handed to the helper model. */
export const AUTO_TITLE_EXCERPT_MAX_CHARS = 4000;

/**
 * Bound an excerpt to `AUTO_TITLE_EXCERPT_MAX_CHARS`, keeping the head.
 *
 * The head is what identifies the topic — the opening ask — so a long first
 * message is cut at the end rather than sampled from the middle.
 */
export function boundAutoTitleExcerpt(
  text: string,
  maxChars: number = AUTO_TITLE_EXCERPT_MAX_CHARS,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}\n[...]`;
}

export function createAutoTitlePrompt(
  options: AutoTitlePromptOptions,
): string {
  const lengthTarget =
    options.lengthTarget ?? DEFAULT_AUTO_SESSION_TITLE_MAX_LENGTH;
  const language = options.language ?? "auto";

  return [
    "Name this coding-assistant session so it can be recognized in a list.",
    "",
    `Maximum length: ${lengthTarget} characters. Shorter is better.`,
    "Name the concrete task, topic, or artifact — for example",
    '"Stripe anfragen", "Wohnungssuche Kleinanzeigen", "Telegram-Bot Deploy".',
    LANGUAGE_INSTRUCTION[language],
    "No generic titles like \"Chat\", \"Session\", \"Help request\" or",
    '"Diverse Aufgaben". No date, no session id, no file path unless the file',
    "is the actual subject.",
    options.currentTitle
      ? `The current title is "${options.currentTitle}" — only reuse it if it is already a good name.`
      : undefined,
    "Return only the title. No quotes, no label, no trailing period.",
    "",
    "Opening of the session:",
    options.transcriptExcerpt,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
