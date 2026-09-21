/**
 * What a limited user's New Session form may still choose.
 *
 * Contract: topics/limited-users.md § Delivery v1. The launch route is the
 * enforcement; this module exists so the form can stop offering a choice the
 * route would refuse, and instead state the fixed value. Every value here is
 * derived from the acting principal the server reported, never from anything
 * the form decided on its own.
 */

import {
  ALL_PROVIDERS,
  isEffortLevel,
  lockedThinkingOption,
  type ActingPrincipal,
  type EffortLevel,
  type ProviderName,
  type SessionSandboxLevel,
  type ThinkingOption,
} from "@yep-anywhere/shared";

export interface LaunchLock {
  /**
   * Whether the acting principal is a limited user. True on its own already
   * fixes the sandbox, which is not theirs to clear even with no field lock.
   */
  limited: boolean;
  provider: ProviderName | null;
  model: string | null;
  effort: EffortLevel | null;
}

export const UNLOCKED_LAUNCH: LaunchLock = {
  limited: false,
  provider: null,
  model: null,
  effort: null,
};

/** The launch lock the acting principal imposes. */
export function launchLockFor(principal: ActingPrincipal): LaunchLock {
  if (principal.username === null) return UNLOCKED_LAUNCH;
  const lock = principal.grants?.lock ?? {};
  const provider =
    lock.provider &&
    (ALL_PROVIDERS as readonly string[]).includes(lock.provider)
      ? (lock.provider as ProviderName)
      : null;
  return {
    limited: true,
    provider,
    model: lock.model ?? null,
    effort: isEffortLevel(lock.effort) ? lock.effort : null,
  };
}

/** Whether any launch field is fixed rather than chosen. */
export function hasFixedLaunchFields(lock: LaunchLock): boolean {
  return lock.limited;
}

export interface LaunchLockOverrides {
  provider?: ProviderName;
  model?: string;
  thinking?: ThinkingOption;
  sandboxLevel?: SessionSandboxLevel;
}

/**
 * The session-create fields the lock settles, for spreading over the options
 * the form assembled. Applied at submit as well as seeded into form state, so
 * a submit that races the principal request still launches within the lock.
 */
export function launchLockOverrides(lock: LaunchLock): LaunchLockOverrides {
  if (!lock.limited) return {};
  return {
    ...(lock.provider ? { provider: lock.provider } : {}),
    ...(lock.model ? { model: lock.model } : {}),
    ...(lock.effort ? { thinking: lockedThinkingOption(lock.effort) } : {}),
    sandboxLevel: "project-write",
  };
}
