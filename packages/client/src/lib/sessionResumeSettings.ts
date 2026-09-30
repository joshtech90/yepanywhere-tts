import type { PermissionMode, ThinkingOption } from "@yep-anywhere/shared";

interface ResumeOverrides {
  mode?: PermissionMode;
  model?: string;
  thinking?: ThinkingOption;
}

/** Do not promote browser defaults or stale display values into user intent. */
export function sessionResumeOverrides(
  restoreOnServer: boolean,
  fallback: ResumeOverrides,
  explicit: ResumeOverrides,
): ResumeOverrides {
  return restoreOnServer
    ? explicit
    : {
        mode: explicit.mode ?? fallback.mode,
        model: explicit.model ?? fallback.model,
        thinking: explicit.thinking ?? fallback.thinking,
      };
}

export function stoppedSessionPermissionMode(
  fallback: PermissionMode,
  explicit: PermissionMode | undefined,
  saved: PermissionMode | undefined,
): PermissionMode {
  return explicit ?? saved ?? fallback;
}
