import type { ClientDefaults } from "@yep-anywhere/shared";

/** The discoverable history surface stays default-off; bang execution is baseline. */
export function bangHistoryViewEnabled(
  clientDefaults?: ClientDefaults,
): boolean {
  return clientDefaults?.bangCommandsEnabled === true;
}
