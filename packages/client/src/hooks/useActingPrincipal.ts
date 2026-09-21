import { useCallback, useEffect, useState } from "react";
import type { ActingPrincipal } from "@yep-anywhere/shared";
import { api } from "../api/client";
import { useServerSettings } from "./useServerSettings";

/**
 * Who this client is acting as: the superuser, or one limited user.
 *
 * Contract: topics/limited-users.md § Delivery v1. The server is the
 * authority; this hook only decides what to show. A server without the
 * feature answers 403/404, which reads here as "superuser, feature off" —
 * the pre-limited-users behavior.
 */
const SUPERUSER_PRINCIPAL: ActingPrincipal = {
  superuser: true,
  username: null,
  switched: false,
  locked: false,
  enabled: false,
  hasLimitedUsers: false,
  logoutRedirect: "stay",
};

export interface ActingPrincipalState {
  principal: ActingPrincipal;
  loading: boolean;
  /**
   * Whether `principal` is the server's answer rather than the superuser
   * placeholder. Before this is true the placeholder is indistinguishable
   * from a real superuser, so a caller that would send a superuser-only
   * request must wait: a switched superuser or a limited user would
   * otherwise fire one refused request on every load.
   */
  resolved: boolean;
  refresh: () => Promise<void>;
}

/**
 * Ask who this client is acting as. The request is skipped entirely while the
 * feature is off, which is the default: a server with one principal should
 * not answer an identity request on every page load.
 */
export function useActingPrincipal(): ActingPrincipalState {
  const { settings, isLoading: settingsLoading } = useServerSettings();
  const enabled = settings?.limitedUsersEnabled === true;
  const [principal, setPrincipal] =
    useState<ActingPrincipal>(SUPERUSER_PRINCIPAL);
  const [loading, setLoading] = useState(false);
  const [answered, setAnswered] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setPrincipal(SUPERUSER_PRINCIPAL);
      return;
    }
    setLoading(true);
    try {
      setPrincipal(await api.getActingPrincipal());
    } catch {
      setPrincipal(SUPERUSER_PRINCIPAL);
    } finally {
      setAnswered(true);
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // With the feature off there is no principal but the superuser, so the
  // placeholder is already the answer and nothing needs to wait.
  const resolved = settingsLoading ? false : !enabled || answered;

  return { principal, loading, resolved, refresh };
}

/** Whether the acting principal is a limited user. */
export function isLimitedPrincipal(principal: ActingPrincipal): boolean {
  return principal.username !== null;
}
