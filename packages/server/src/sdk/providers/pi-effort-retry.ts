/**
 * Retrying a pi turn the model server refused over its thinking level.
 *
 * The provider sets the refused turn aside through YA's pi extension
 * (`pi-yep-anywhere-extension.mjs`), which records the refusal as a custom
 * session entry; the live stream and the session reader both describe it with
 * {@link piEffortRetryNoticeText}. topics/pi-provider.md § Thinking levels and
 * refused turns owns the contract.
 */

import { fileURLToPath } from "node:url";

/** The extension command YA sends; also named in the extension itself. */
export const PI_EFFORT_RETRY_COMMAND = "yep-anywhere-effort-retry";

/** `customType` of the session entry recording one refusal. */
export const PI_EFFORT_RETRY_ENTRY_TYPE = "yep-anywhere.effort-retry";

/** One refusal: the level refused, the level asked for next, and why. */
export interface PiEffortRetryRecord {
  refusedLevel: string;
  retryLevel: string;
  error: string;
}

/** Path of YA's pi extension, passed to every session pi launches. */
export function yepAnywherePiExtensionPath(): string {
  return fileURLToPath(
    new URL("./pi-yep-anywhere-extension.mjs", import.meta.url),
  );
}

/**
 * Read a refusal record from a session entry's `data`, or undefined when the
 * entry is not one YA wrote.
 */
export function readPiEffortRetryRecord(
  data: unknown,
): PiEffortRetryRecord | undefined {
  if (!data || typeof data !== "object") return undefined;
  const { refusedLevel, retryLevel, error } = data as Record<string, unknown>;
  if (
    typeof refusedLevel !== "string" ||
    typeof retryLevel !== "string" ||
    typeof error !== "string"
  ) {
    return undefined;
  }
  return { refusedLevel, retryLevel, error };
}

/**
 * The transcript's account of a refusal.
 *
 * `resent` says whether the turn was set aside and its prompt sent again at
 * the lower level; otherwise only later turns ask for that level.
 */
export function piEffortRetryNoticeText(
  record: PiEffortRetryRecord,
  resent: boolean,
): string {
  const summary = resent
    ? `_This model refused thinking level **${record.refusedLevel}**, so the ` +
      `turn was retried at **${record.retryLevel}**._`
    : `_This model refused thinking level **${record.refusedLevel}**. Later ` +
      `turns ask for **${record.retryLevel}**; send the prompt again to ` +
      `retry it._`;
  const quoted = record.error
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `${summary}\n\n${quoted}`;
}
