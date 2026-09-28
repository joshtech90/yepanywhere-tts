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
  /**
   * The locked fields exactly as the server stores them. A provider or effort
   * this client cannot name is still a lock: the route refuses any other
   * value, so the form withholds the picker, states the value literally, and
   * sends it back unchanged.
   */
  provider: string | null;
  model: string | null;
  effort: string | null;
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
  return {
    limited: true,
    provider: lock.provider || null,
    model: lock.model || null,
    effort: lock.effort || null,
  };
}

/** The locked provider when this client knows it, for seeding the picker. */
export function knownLockedProvider(lock: LaunchLock): ProviderName | null {
  return lock.provider &&
    (ALL_PROVIDERS as readonly string[]).includes(lock.provider)
    ? (lock.provider as ProviderName)
    : null;
}

/** The locked effort when this client knows it, for seeding the picker. */
export function knownLockedEffort(lock: LaunchLock): EffortLevel | null {
  return isEffortLevel(lock.effort) ? lock.effort : null;
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
  // A value this client cannot name travels verbatim: the server issued it
  // and the route compares it as a string, so the request types' narrower
  // unions describe only what this client could have chosen itself.
  return {
    ...(lock.provider ? { provider: lock.provider as ProviderName } : {}),
    ...(lock.model ? { model: lock.model } : {}),
    ...(lock.effort
      ? { thinking: lockedThinkingOption(lock.effort) as ThinkingOption }
      : {}),
    sandboxLevel: "project-write",
  };
}
