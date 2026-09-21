/**
 * Launch policy a limited user's new session must obey.
 *
 * Contract: topics/limited-users.md § Delivery v1.
 *
 * Two things are settled here, at the route, not in the form: the session is
 * sandboxed whether or not the request asked for it, and any locked
 * provider, model, or effort is applied. A request that names a value
 * conflicting with the lock is refused rather than quietly overridden, so a
 * stale client cannot believe it launched what it asked for.
 */

import type { Context } from "hono";
import {
  lockedThinkingOption,
  thinkingOptionEffort,
} from "@yep-anywhere/shared";
import { type Principal, PRINCIPAL_VARIABLE } from "../auth/principal.js";

export interface LimitedLaunchBody {
  provider?: string;
  model?: string;
  thinking?: string;
  sandboxLevel?: string;
  sandboxNetworkFirewall?: boolean;
}

export type LimitedLaunchOutcome =
  | { kind: "superuser" }
  | { kind: "applied"; username: string }
  | { kind: "error"; error: string };

/** The acting principal, defaulting to the superuser when unresolved. */
export function principalFor(c: Context): Principal {
  return (
    (c.get(PRINCIPAL_VARIABLE) as Principal | undefined) ?? {
      kind: "superuser",
    }
  );
}

/**
 * The acting limited username, or undefined for the superuser. This is the
 * attribution every usage record and user turn carries: absent means the
 * superuser, which is also what records predating limited users mean.
 */
export function actingUsername(c: Context): string | undefined {
  const principal = principalFor(c);
  return principal.kind === "limited" ? principal.username : undefined;
}

/**
 * Apply the limited user's launch policy to a session-create body in place.
 * Returns what happened so the caller can record session ownership.
 */
export function applyLimitedLaunchPolicy(
  c: Context,
  body: LimitedLaunchBody,
): LimitedLaunchOutcome {
  const principal = principalFor(c);
  if (principal.kind !== "limited") return { kind: "superuser" };

  // Sandbox is not the user's to clear.
  body.sandboxLevel = "project-write";

  const { lock } = principal.grants;
  const conflicts: Array<[keyof LimitedLaunchBody, string | undefined]> = [
    ["provider", lock.provider],
    ["model", lock.model],
  ];
  for (const [field, locked] of conflicts) {
    if (!locked) continue;
    const requested = body[field];
    if (
      typeof requested === "string" &&
      requested.length > 0 &&
      requested !== "default" &&
      requested !== locked
    ) {
      return {
        kind: "error",
        error: `This user is limited to ${String(field)} "${locked}"`,
      };
    }
    (body as Record<string, unknown>)[field] = locked;
  }

  // The lock names a bare effort; the request names a thinking option. Compare
  // like with like, so "on:high" against a "high" lock is agreement, not a
  // conflict, and a request that names no effort at all ("off", "auto") takes
  // the locked one rather than escaping the budget the superuser set.
  if (lock.effort) {
    const requested = body.thinking;
    const requestedEffort =
      typeof requested === "string" ? thinkingOptionEffort(requested) : null;
    if (requestedEffort !== null && requestedEffort !== lock.effort) {
      return {
        kind: "error",
        error: `This user is limited to effort "${lock.effort}"`,
      };
    }
    body.thinking = lockedThinkingOption(lock.effort);
  }

  return { kind: "applied", username: principal.username };
}
