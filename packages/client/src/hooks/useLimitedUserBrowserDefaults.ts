import { useEffect } from "react";
import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { limitedUserDefaultsApi } from "../api/limitedUserDefaultsClient";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";
import { applyLimitedUserBrowserDefaults } from "../lib/limitedUserBrowserDefaults";
import { useActingPrincipal } from "./useActingPrincipal";
import { useVersion } from "./useVersion";

/**
 * Take the superuser's published browser defaults once per revision on a
 * limited user's own login. A superuser acting as a limited user is skipped:
 * this browser's settings are the superuser's own, not the account's.
 */
export function useLimitedUserBrowserDefaults(): void {
  const { principal, resolved } = useActingPrincipal();
  const { version } = useVersion();
  const sourceKey = useClientSummarySourceKey();
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.limitedUserBrowserDefaults.name,
  );
  const username = resolved && !principal.switched ? principal.username : null;

  useEffect(() => {
    if (!supported || !username) return;
    let cancelled = false;
    void limitedUserDefaultsApi
      .getLimitedUserBrowserDefaults()
      .then(({ backup }) => {
        if (cancelled || !backup) return;
        const account = JSON.stringify([sourceKey, username]);
        if (applyLimitedUserBrowserDefaults(backup, account)) {
          window.location.reload();
        }
      })
      .catch(() => {
        // Nothing for the user to act on and nothing to log: the revision
        // stays unapplied and the next load tries again.
      });
    return () => {
      cancelled = true;
    };
  }, [supported, username, sourceKey]);
}
