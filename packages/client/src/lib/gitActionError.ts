import type { TranslationFn } from "../i18n";

/** Keep credentials out of visible diagnostics and their clipboard copy. */
export function redactGitError(detail: string): string {
  return detail
    .replace(/(https?:\/\/)[^\s/"'<>]*@/gi, "$1[redacted]@")
    .replace(
      /([?&](?:access_token|token|password|secret|api_key)=)[^\s&"'<>]*/gi,
      "$1[redacted]",
    )
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, "$1[redacted]")
    .trim();
}

export function describeGitFailure(
  detail: string | undefined,
  t: TranslationFn,
) {
  const safeDetail = redactGitError(detail ?? "");
  let reason: string | null = null;
  let hint: string | null = null;
  if (/permission denied \([^)]*publickey[^)]*\)/i.test(safeDetail)) {
    reason = t("gitStatusErrorSshAuth");
    hint = t("gitStatusErrorSshAuthHint");
  } else if (/bad (?:owner or permissions|permissions)/i.test(safeDetail)) {
    reason = t("gitStatusErrorSshPermissions");
    hint = t("gitStatusErrorSshPermissionsHint");
  } else if (
    /https?:\/\//i.test(safeDetail) &&
    /authentication failed|could not read (?:username|password)|invalid (?:username|password|credentials)|password authentication is not supported/i.test(
      safeDetail,
    )
  ) {
    reason = t("gitStatusErrorHttpsAuth");
    hint = t("gitStatusErrorHttpsAuthHint");
  } else if (/authentication failed/i.test(safeDetail)) {
    reason = t("gitStatusErrorAuth");
    hint = t("gitStatusErrorAuthHint");
  } else if (/timed?\s*out|\btimeout\b|ETIMEDOUT/i.test(safeDetail)) {
    const seconds =
      /Git operation timed out after (\d+(?:\.\d+)?) seconds\./i.exec(
        safeDetail,
      )?.[1];
    reason = seconds
      ? t("gitStatusErrorTimeoutSeconds", { seconds })
      : t("gitStatusErrorTimeout");
    hint = t("gitStatusErrorTimeoutHint");
  } else if (
    /non-fast-forward|\(fetch first\)|(?:can't|cannot|not possible to) fast-forward/i.test(
      safeDetail,
    )
  ) {
    reason = t("gitStatusErrorNonFastForward");
    hint = t("gitStatusErrorNonFastForwardHint");
  }
  return { reason, hint, detail: safeDetail };
}

export type GitFailureDescription = ReturnType<typeof describeGitFailure>;
