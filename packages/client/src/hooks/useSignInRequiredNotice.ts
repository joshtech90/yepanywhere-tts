import { useLocation } from "react-router-dom";
import { useI18n } from "../i18n";
import type { AutoResumeErrorReason } from "../lib/connection/remoteErrors";

/**
 * Router state carried to a login form when the server confirmed that the
 * saved session can no longer resume, so the form explains why it appeared.
 */
export interface SignInRequiredState {
  signInRequired: AutoResumeErrorReason;
}

export function signInRequiredState(
  reason: AutoResumeErrorReason,
): SignInRequiredState {
  return { signInRequired: reason };
}

/** The explanation for a login form reached by a confirmed resume rejection. */
export function useSignInRequiredNotice(): string | null {
  const { t } = useI18n();
  const state = useLocation().state as Partial<SignInRequiredState> | null;
  switch (state?.signInRequired) {
    case "auth_failed":
      return t("hostOfflineMessageResumeRejected");
    case "resume_incompatible":
      return t("hostOfflineMessageResumeIncompatible");
    default:
      return null;
  }
}
