import type { PermissionMode } from "@yep-anywhere/shared";

/**
 * The owner's saved default mode (Settings -> new session defaults). When it
 * bypasses permissions, every process start, resume, message and mode change
 * that asks for nothing or only for "default" bypasses too, so no chat falls
 * back to asking for approvals (Joscha 29.09.2026). Explicitly chosen other
 * modes (plan, acceptEdits, auto) stay deliberate choices.
 */
let standingSource: (() => PermissionMode | undefined) | undefined;

export function setStandingPermissionModeSource(
  source: (() => PermissionMode | undefined) | undefined,
): void {
  standingSource = source;
}

export function resolveStandingPermissionMode(
  requested: PermissionMode | undefined,
  standing: PermissionMode | undefined,
  fallback: PermissionMode,
): PermissionMode {
  if (
    standing === "bypassPermissions" &&
    (requested === undefined || requested === "default")
  ) {
    return "bypassPermissions";
  }
  return requested ?? standing ?? fallback;
}

/** Applies the configured standing mode (if any) to one requested mode. */
export function applyStandingPermissionMode(
  requested: PermissionMode | undefined,
  fallback: PermissionMode = "default",
): PermissionMode {
  return resolveStandingPermissionMode(requested, standingSource?.(), fallback);
}
