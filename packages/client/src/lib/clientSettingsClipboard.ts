import {
  BROWSER_SETTINGS_BACKUP_VERSION,
  type BrowserSettingsBackup,
  type BrowserSettingsBackupValues,
} from "@yep-anywhere/shared";
import { BROWSER_SETTINGS_BACKUP_KEYS } from "./browserSettingsBackup";
import { portableBrowserSettings } from "./limitedUserBrowserDefaults";

/**
 * Clipboard form of the portable browser preference set, for carrying
 * preferences between YA servers (topics/settings-ui-placement.md
 * § Explicit browser-settings transfer). It holds the same allowlisted keys as
 * the server slot, so no credential or host-bound state enters the text.
 */
export const CLIENT_SETTINGS_DOCUMENT_KIND = "ya-client-settings";
export const CLIENT_SETTINGS_DOCUMENT_VERSION = 1;

export interface ClientSettingsDocument {
  kind: typeof CLIENT_SETTINGS_DOCUMENT_KIND;
  version: typeof CLIENT_SETTINGS_DOCUMENT_VERSION;
  /** Browser host the copy was made from; informational only. */
  sourceHost: string;
  copiedAt: string;
  settings: BrowserSettingsBackupValues;
}

export type ClientSettingsDocumentProblem =
  | "not-json"
  | "wrong-kind"
  | "unsupported-version"
  | "malformed";

export class ClientSettingsDocumentError extends Error {
  constructor(readonly problem: ClientSettingsDocumentProblem) {
    super(`Invalid client settings document: ${problem}`);
    this.name = "ClientSettingsDocumentError";
  }
}

export function formatClientSettingsDocument(
  settings: BrowserSettingsBackupValues,
  sourceHost: string,
  copiedAt: Date = new Date(),
): string {
  const document: ClientSettingsDocument = {
    kind: CLIENT_SETTINGS_DOCUMENT_KIND,
    version: CLIENT_SETTINGS_DOCUMENT_VERSION,
    sourceHost,
    copiedAt: copiedAt.toISOString(),
    settings,
  };
  return JSON.stringify(document, null, 2);
}

export interface ParsedClientSettings {
  document: ClientSettingsDocument;
  /** Keys this client does not treat as portable; never applied. */
  ignoredKeys: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate pasted text. Unknown keys, such as ones from a newer client, are
 * dropped and reported rather than rejected; anything else malformed throws.
 */
export function parseClientSettingsDocument(
  text: string,
): ParsedClientSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new ClientSettingsDocumentError("not-json");
  }
  if (!isRecord(raw) || raw.kind !== CLIENT_SETTINGS_DOCUMENT_KIND) {
    throw new ClientSettingsDocumentError("wrong-kind");
  }
  if (raw.version !== CLIENT_SETTINGS_DOCUMENT_VERSION) {
    throw new ClientSettingsDocumentError("unsupported-version");
  }
  const { settings } = raw;
  if (
    !isRecord(settings) ||
    !Object.values(settings).every((value) => typeof value === "string")
  ) {
    throw new ClientSettingsDocumentError("malformed");
  }
  const values = settings as BrowserSettingsBackupValues;
  const portable = portableBrowserSettings(values);
  return {
    document: {
      kind: CLIENT_SETTINGS_DOCUMENT_KIND,
      version: CLIENT_SETTINGS_DOCUMENT_VERSION,
      sourceHost: typeof raw.sourceHost === "string" ? raw.sourceHost : "",
      copiedAt: typeof raw.copiedAt === "string" ? raw.copiedAt : "",
      settings: portable,
    },
    ignoredKeys: Object.keys(values).filter(
      (key) => !Object.hasOwn(portable, key),
    ),
  };
}

export interface ClientSettingChange {
  key: string;
  /** null means the setting is unset and the browser uses its default. */
  from: string | null;
  to: string | null;
}

/** Applying replaces the whole portable set, so absent keys reset too. */
export function diffClientSettings(
  current: BrowserSettingsBackupValues,
  incoming: BrowserSettingsBackupValues,
): ClientSettingChange[] {
  const changes: ClientSettingChange[] = [];
  for (const key of BROWSER_SETTINGS_BACKUP_KEYS) {
    const from = current[key] ?? null;
    const to = incoming[key] ?? null;
    if (from !== to) changes.push({ key, from, to });
  }
  return changes;
}

/** Adapt a pasted document to the server-slot shape that Apply consumes. */
export function clientSettingsAsBackup(
  document: ClientSettingsDocument,
): BrowserSettingsBackup {
  return {
    version: BROWSER_SETTINGS_BACKUP_VERSION,
    savedAt: document.copiedAt,
    values: document.settings,
  };
}
