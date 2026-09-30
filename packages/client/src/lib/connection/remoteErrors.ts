import { getResumeError } from "./resumeErrors";

export type AutoResumeErrorReason =
  | "server_offline"
  | "unknown_username"
  | "relay_timeout"
  | "relay_unreachable"
  | "direct_unreachable"
  | "resume_timeout"
  | "resume_incompatible"
  | "resume_verification"
  | "auth_failed"
  | "other";

export function requiresResumeLogin(reason: AutoResumeErrorReason): boolean {
  return reason === "auth_failed" || reason === "resume_incompatible";
}

export function canRetryResume(reason: AutoResumeErrorReason): boolean {
  return (
    !requiresResumeLogin(reason) &&
    reason !== "resume_verification" &&
    reason !== "unknown_username"
  );
}

export function categorizeResumeError(error: unknown): AutoResumeErrorReason {
  const resume = getResumeError(error);
  if (resume) {
    switch (resume.kind) {
      case "timeout":
        return "resume_timeout";
      case "rejected":
        return "auth_failed";
      case "incompatible":
        return "resume_incompatible";
      case "verification":
      case "protocol":
        return "resume_verification";
      case "server":
        return "other";
    }
  }
  // Legacy network diagnostics may lack codes. They can classify reachability,
  // but their wording is never evidence for deleting an authentication session.
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("server_offline")) return "server_offline";
  if (message.includes("unknown_username")) return "unknown_username";
  if (
    message.includes("waiting for server timed out") ||
    message.includes("relay connection timeout")
  )
    return "relay_timeout";
  if (
    message.includes("failed to connect to relay") ||
    message.includes("relay connection closed") ||
    message.includes("relay connection error")
  )
    return "relay_unreachable";
  if (
    message.includes("websocket") ||
    message.includes("connection failed") ||
    message.includes("failed to connect") ||
    message.includes("connection refused") ||
    message.includes("network error")
  )
    return "direct_unreachable";
  return "other";
}
