import type {
  BrowserSettingsBackupResponse,
  BrowserSettingsBackupValues,
} from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

/**
 * The browser defaults slot limited users' clients apply once per revision.
 * Anyone may read it; only the superuser may write it.
 */
export const limitedUserDefaultsApi = {
  getLimitedUserBrowserDefaults: () =>
    fetchJSON<BrowserSettingsBackupResponse>("/settings/limited-user-defaults"),

  saveLimitedUserBrowserDefaults: (input: {
    version: number;
    values: BrowserSettingsBackupValues;
  }) =>
    fetchJSON<BrowserSettingsBackupResponse>(
      "/settings/limited-user-defaults",
      { method: "PUT", body: JSON.stringify(input) },
    ),
};
